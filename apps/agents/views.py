import uuid

from django.conf import settings
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.tokens import digest, issue_token
from apps.execution.models import Executor
from apps.execution.services import local_executor_token, revoke_executor
from apps.workspaces.api import WorkspaceViewSet
from apps.workspaces.services import lock_membership, require_manager

from .models import Agent
from .serializers import AgentSerializer, ProjectSDKSerializer, ProjectSerializer


class ExecutorRegistrationRequest(serializers.Serializer):
    locally_managed = serializers.BooleanField(default=False)


class ExecutorRegistration(serializers.Serializer):
    executor_id = serializers.UUIDField()
    agent_id = serializers.UUIDField()
    token = serializers.CharField()


class AgentViewSet(WorkspaceViewSet):
    queryset = Agent.objects.all()
    serializer_class = AgentSerializer

    @extend_schema(
        methods=["POST"], request=ExecutorRegistrationRequest, responses=ExecutorRegistration
    )
    @extend_schema(methods=["DELETE"], request=None, responses={204: None})
    @action(detail=True, methods=["post", "delete"])
    @transaction.atomic
    def executor(self, request, pk=None):
        require_manager(lock_membership(request))
        agent = self.get_object()
        existing = Executor.objects.filter(agent=agent).first()
        if existing:
            revoke_executor(existing)
        if request.method == "DELETE":
            return Response(status=204)
        data = ExecutorRegistrationRequest(data=request.data)
        data.is_valid(raise_exception=True)
        locally_managed = data.validated_data["locally_managed"]
        if locally_managed and not getattr(settings, "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN", ""):
            raise ValidationError("Local executor management is not configured.")
        token = issue_token()
        executor, _ = Executor.objects.update_or_create(
            agent=agent,
            defaults={
                "name": f"agent-{agent.pk}",
                "token_hash": digest(token),
                "enabled": True,
                "locally_managed": locally_managed,
                "registration_nonce": uuid.uuid4(),
            },
        )
        if locally_managed:
            token = local_executor_token(executor)
            executor.token_hash = digest(token)
            executor.save(update_fields=["token_hash"])
        return Response(
            {"executor_id": executor.pk, "agent_id": agent.pk, "token": token},
            headers={"Cache-Control": "no-store"},
        )


class ProjectViewSet(AgentViewSet):
    serializer_class = ProjectSerializer

    @extend_schema(responses=ProjectSDKSerializer)
    @action(detail=True, methods=["get"])
    def sdk(self, request, pk=None):
        from .sdk import project_sdk

        return Response(project_sdk(self.get_object(), token=request.auth))
