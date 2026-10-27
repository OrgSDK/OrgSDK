from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import audit
from apps.core.tokens import digest, issue_token
from apps.credentials.models import Credential
from apps.credentials.oauth import execution_secret
from apps.credentials.services import allowed_credentials
from apps.runs.models import Run
from apps.runs.services import TERMINAL, append_event, complete_run
from apps.workspaces.models import Workspace

from . import serializers
from .authentication import ExecutorAuthentication, RunAuthentication
from .models import Executor, WorkspaceSettings
from .services import ensure_local_executor, lease_deadline, local_executor_token


class ExecutorView(APIView):
    authentication_classes = [ExecutorAuthentication]
    throttle_classes = []


class RegisterView(ExecutorView):
    @extend_schema(request=serializers.Registration, responses=serializers.Registered)
    def post(self, request):
        data = serializers.Registration(data=request.data)
        data.is_valid(raise_exception=True)
        executor = request.auth
        executor.protocol_version = data.validated_data["protocol_version"]
        executor.capabilities = data.validated_data["capabilities"]
        executor.last_seen_at = timezone.now()
        executor.save(update_fields=["protocol_version", "capabilities", "last_seen_at"])
        return Response(executor_configuration(executor))


class ClaimView(ExecutorView):
    @extend_schema(request=None, responses={200: serializers.Claim, 204: None})
    @transaction.atomic
    def post(self, request):
        Workspace.objects.get(pk=request.auth.agent.workspace_id)
        executor = Executor.objects.filter(pk=request.auth.pk, enabled=True).first()
        if not executor:
            raise PermissionDenied("Executor revoked.")
        if not executor.agent_id or not executor.agent.enabled:
            return Response(status=204)
        # Serialize claims per workspace even when several supervisors claim concurrently.
        workspaces = WorkspaceSettings.objects.filter(
            enabled=True, workspace_id=executor.agent.workspace_id
        )
        for config in workspaces.order_by("workspace_id"):
            Workspace.objects.get(pk=config.workspace_id)
            if Run.objects.filter(
                agent_id=executor.agent_id, status__in=["running", "waiting_approval"]
            ).exists():
                return Response(status=204)
            active = Run.objects.filter(
                workspace_id=config.workspace_id, status__in=["running", "waiting_approval"]
            ).count()
            if active >= config.max_concurrent_runs:
                continue
            candidates = Run.objects.filter(
                workspace_id=config.workspace_id,
                status="queued",
                agent_id=executor.agent_id,
                operation__in=[
                    c
                    for c in executor.capabilities
                    if c in {"action", "code", "validate", "test"}
                    and (c != "code" or executor.protocol_version >= 2)
                    and (c not in {"validate", "test"} or executor.protocol_version >= 3)
                ],
            )
            if executor.protocol_version < 3:
                candidates = candidates.filter(
                    ~Q(snapshot__has_key="validation_mode") | Q(snapshot__validation_mode="legacy")
                )
            run = candidates.order_by("created_at").first()
            if not run:
                continue
            if run.parent_id and (run.parent.cancel_requested or run.parent.status in TERMINAL):
                run.status = "cancelled"
                run.cancel_requested = True
                run.save(update_fields=["status", "cancel_requested"])
                continue
            if (
                not run.actor.is_active
                or not run.workspace.memberships.filter(user=run.actor).exists()
            ):
                run.status = "cancelled"
                run.save(update_fields=["status"])
                continue
            capability = issue_token()
            run.status = "running"
            run.executor = executor
            run.deadline = timezone.now() + timedelta(hours=1)
            run.lease_expires_at = lease_deadline()
            run.capability_hash = digest(capability)
            run.save()
            return Response(
                {
                    "protocol_version": (
                        3
                        if run.operation in {"validate", "test"}
                        or run.snapshot.get("validation_mode") == "semantic"
                        else 2
                        if run.operation == "code"
                        else 1
                    ),
                    "run_id": str(run.pk),
                    "workspace_id": run.workspace_id,
                    "actor_id": run.actor_id,
                    "operation": run.operation,
                    "inputs": run.inputs,
                    "snapshot": run.snapshot,
                    "capability": capability,
                    "deadline": run.deadline,
                    "lease_seconds": 60,
                }
            )
        return Response(status=204)


class RunView(APIView):
    authentication_classes = [RunAuthentication]
    throttle_classes = []

    def current_run(self, request, run_id):
        if request.auth.pk != run_id:
            raise PermissionDenied("Capability is bound to another run.")
        Workspace.objects.get(pk=request.auth.workspace_id)
        run = Run.objects.get(pk=run_id)
        if (
            not run.capability_hash
            or run.capability_hash != request.auth.capability_hash
            or not run.executor
            or not run.executor.enabled
        ):
            raise PermissionDenied("Run capability revoked.")
        return run


class HeartbeatView(RunView):
    @extend_schema(request=None, responses=serializers.Heartbeat)
    @transaction.atomic
    def post(self, request, run_id):
        run = self.current_run(request, run_id)
        if run.status not in TERMINAL:
            run.lease_expires_at = min(lease_deadline(), run.deadline)
            run.save(update_fields=["lease_expires_at"])
        return Response({"cancel_requested": run.cancel_requested, "status": run.status})


class EventView(RunView):
    @extend_schema(request=serializers.Event, responses={204: None})
    @transaction.atomic
    def post(self, request, run_id):
        run = self.current_run(request, run_id)
        if run.status in TERMINAL:
            raise ValidationError("Run is terminal.")
        data = serializers.Event(data=request.data)
        data.is_valid(raise_exception=True)
        append_event(run, data.validated_data)
        return Response(status=204)


class CompleteView(RunView):
    @extend_schema(request=serializers.Completion, responses={204: None})
    @transaction.atomic
    def post(self, request, run_id):
        run = self.current_run(request, run_id)
        data = serializers.Completion(data=request.data)
        data.is_valid(raise_exception=True)
        complete_run(run, data.validated_data)
        return Response(status=204)


class SecretView(RunView):
    @extend_schema(responses=serializers.Secret)
    @transaction.atomic
    def get(self, request, credential_id):
        run = self.current_run(request, request.auth.pk)
        if (
            run.status in TERMINAL
            or run.cancel_requested
            or str(credential_id) not in allowed_credentials(run)
        ):
            raise PermissionDenied("Credential is outside this run capability.")
        credential = get_object_or_404(Credential, pk=credential_id, workspace=run.workspace)
        audit(run.workspace, run.actor, "credential.used", credential)
        return Response(
            {"secret": execution_secret(credential)}, headers={"Cache-Control": "no-store"}
        )


def executor_configuration(executor):
    from apps.actions.services import plugin_snapshot

    return {
        "id": str(executor.pk),
        "pool": executor.pool,
        "protocol_version": executor.protocol_version,
        "agent_id": str(executor.agent_id) if executor.agent_id else None,
        "plugins": [
            plugin_snapshot(plugin) for plugin in executor.agent.plugins.filter(enabled=True)
        ]
        if executor.agent_id
        else [],
    }


class ConfigurationView(ExecutorView):
    @extend_schema(responses=serializers.Registered)
    def get(self, request):
        return Response(executor_configuration(request.auth))


class BootstrapView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = []

    @extend_schema(request=None, responses=serializers.Bootstrap)
    @transaction.atomic
    def post(self, request):
        import secrets

        from django.conf import settings

        from apps.agents.models import Agent

        configured = getattr(settings, "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN", "")
        if not configured or not secrets.compare_digest(
            request.headers.get("Authorization", ""), f"Bearer {configured}"
        ):
            raise PermissionDenied("Invalid local bootstrap credential.")
        registrations = []
        for agent in Agent.objects.filter(enabled=True):
            executor = ensure_local_executor(agent)
            if executor and executor.locally_managed and executor.enabled:
                registrations.append(
                    {
                        "agent_id": str(agent.pk),
                        "executor_id": str(executor.pk),
                        "token": local_executor_token(executor),
                    }
                )
        return Response({"registrations": registrations}, headers={"Cache-Control": "no-store"})


class DelegateView(RunView):
    @extend_schema(request=serializers.Delegation, responses=serializers.DelegationResult)
    @transaction.atomic
    def post(self, request, run_id):
        from apps.runs.services import delegate_run

        parent = self.current_run(request, run_id)
        data = serializers.Delegation(data=request.data)
        data.is_valid(raise_exception=True)
        child = delegate_run(parent, **data.validated_data)
        return Response(delegation_result(child))


class DelegationResultView(RunView):
    @extend_schema(responses=serializers.DelegationResult)
    @transaction.atomic
    def get(self, request, run_id, child_id):
        self.current_run(request, run_id)
        return Response(delegation_result(get_object_or_404(Run, pk=child_id, parent_id=run_id)))


def delegation_result(run):
    return {"run_id": str(run.pk), "status": run.status, "output": run.output, "error": run.error}
