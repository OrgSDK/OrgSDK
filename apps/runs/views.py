import asyncio
import json

from asgiref.sync import sync_to_async
from django.db import transaction
from django.http import StreamingHttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response

from apps.actions.serializers import PromoteRequest, SavedActionResultSerializer, VersionSerializer
from apps.api_access.models import AccessToken
from apps.api_access.policy import permitted_queryset
from apps.workspaces.api import WorkspaceViewSet
from apps.workspaces.models import Membership
from apps.workspaces.services import active_membership, lock_membership, require_manager

from . import models, serializers
from .services import (
    TERMINAL,
    cancel_run,
    create_approval,
    create_run,
    decide_approval,
    request_run,
)


class EventStreamRenderer(JSONRenderer):
    media_type = "text/event-stream"
    format = "event-stream"


class RunViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.Run.objects.all()
    serializer_class = serializers.RunSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        active_membership(self.request)
        return permitted_queryset(
            self.request.auth, self.queryset.filter(workspace=self.request.workspace)
        ).order_by("-created_at")

    @extend_schema(request=serializers.RunRequest, responses={201: serializers.RunSerializer})
    def create(self, request):
        active_membership(request)
        data = serializers.RunRequest(data=request.data)
        data.is_valid(raise_exception=True)
        run = request_run(
            workspace=request.workspace,
            actor=request.user,
            data=data.validated_data,
            client_token=request.auth if isinstance(request.auth, AccessToken) else None,
        )
        return Response(self.get_serializer(run).data, status=201)

    @extend_schema(request=None, responses=serializers.RunSerializer)
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def cancel(self, request, pk=None):
        run = cancel_run(workspace=request.workspace, actor=request.user, run=self.get_object())
        return Response(self.get_serializer(run).data)

    @extend_schema(request=serializers.RetryRequest, responses={201: serializers.RunSerializer})
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        original = self.get_object()
        if original.status not in {"failed", "interrupted", "cancelled"}:
            raise ValidationError("Only failed, cancelled or interrupted runs can be retried.")
        serializer = serializers.RetryRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        run = create_run(
            workspace=request.workspace,
            actor=request.user,
            agent=original.agent,
            operation=original.operation,
            inputs=original.inputs,
            key=serializer.validated_data["idempotency_key"],
            version=original.action_version,
            retry_of=original,
            conversation_id=original.conversation_id,
            client_token=request.auth if isinstance(request.auth, AccessToken) else None,
        )
        return Response(self.get_serializer(run).data, status=201)

    @extend_schema(request=PromoteRequest, responses={201: SavedActionResultSerializer})
    @action(detail=True, methods=["post"])
    def promote(self, request, pk=None):
        from apps.actions.authoring import promote_run

        serializer = PromoteRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        if "action" in values:
            values["action_id"] = values.pop("action")
        obj, version = promote_run(
            workspace=request.workspace,
            actor=request.user,
            token=request.auth,
            run=self.get_object(),
            **values,
        )
        return Response(
            {"action": str(obj.pk), "version": VersionSerializer(version).data}, status=201
        )

    @extend_schema(
        methods=["GET"],
        responses=serializers.OwnChatFeedbackSerializer,
    )
    @action(detail=True, methods=["get"])
    @transaction.atomic
    def feedback(self, request, pk=None):
        lock_membership(request)
        run = self.get_object()
        if run.operation != "chat" or run.status != "succeeded":
            raise ValidationError("Feedback requires a completed chat reply.")
        own = models.ChatFeedback.objects.filter(run=run, user=request.user)
        feedback = own.first()
        return Response(
            {"feedback": serializers.ChatFeedbackSerializer(feedback).data if feedback else None}
        )

    @extend_schema(responses=serializers.EventSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def events(self, request, pk=None):
        run = self.get_object()
        return Response(serializers.EventSerializer(run.events.all(), many=True).data)

    @extend_schema(responses={(200, "text/event-stream"): str})
    @action(detail=True, methods=["get"], renderer_classes=[EventStreamRenderer])
    def stream(self, request, pk=None):
        run = self.get_object()
        try:
            after = int(
                request.headers.get("Last-Event-ID", request.query_params.get("after", "0"))
            )
        except ValueError as error:
            raise ValidationError("Invalid event cursor.") from error
        user_id, workspace_id, run_id = request.user.pk, run.workspace_id, run.pk

        @sync_to_async
        def batch(cursor):
            if not Membership.objects.filter(user_id=user_id, workspace_id=workspace_id).exists():
                return [], True
            token = request.auth
            if isinstance(token, AccessToken):
                token = AccessToken.objects.filter(pk=token.pk, revoked=False).first()
                if (
                    token is None
                    or not permitted_queryset(token, models.Run.objects.all())
                    .filter(pk=run_id)
                    .exists()
                ):
                    return [], True
            current = models.Run.objects.get(pk=run_id)
            rows = list(
                current.events.filter(sequence__gt=cursor).values("sequence", "kind", "data")[:100]
            )
            return rows, current.status in TERMINAL

        async def stream_events():
            cursor = after
            for _ in range(30):
                rows, done = await batch(cursor)
                for row in rows:
                    cursor = row["sequence"]
                    yield f"id: {cursor}\ndata: {json.dumps(row)}\n\n"
                if done and len(rows) < 100:
                    yield "event: complete\ndata: {}\n\n"
                    return
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)

        response = StreamingHttpResponse(stream_events(), content_type="text/event-stream")
        response["Cache-Control"] = "no-store"
        response["X-Accel-Buffering"] = "no"
        return response


class ApprovalViewSet(WorkspaceViewSet):
    queryset = models.Approval.objects.all()
    serializer_class = serializers.ApprovalSerializer
    http_method_names = ["get", "post", "head", "options"]

    def perform_create(self, serializer):
        active_membership(self.request)
        serializer.instance = create_approval(
            workspace=self.request.workspace,
            actor=self.request.user,
            **serializer.validated_data,
        )

    @extend_schema(request=serializers.DecisionSerializer, responses=serializers.ApprovalSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        require_manager(active_membership(request))
        if isinstance(request.auth, AccessToken) and "approve" not in request.auth.scopes:
            raise PermissionDenied("Approval scope required.")
        current = self.get_object()
        serializer = serializers.DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        approval = decide_approval(
            workspace=request.workspace,
            actor=request.user,
            approval=current,
            decision=serializer.validated_data["decision"],
        )
        return Response(self.get_serializer(approval).data)


class ConversationViewSet(WorkspaceViewSet):
    queryset = models.Conversation.objects.all()
    serializer_class = serializers.ConversationSerializer
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().order_by("-updated_at", "-pk")

    @extend_schema(responses=serializers.RunSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def turns(self, request, pk=None):
        conversation = self.get_object()
        return Response(
            serializers.RunSerializer(
                conversation.turns.order_by("created_at", "pk"), many=True
            ).data
        )
