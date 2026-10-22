from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.api_access.policy import permitted_queryset
from apps.audit.services import audit
from apps.runs.serializers import RunSerializer
from apps.workspaces.api import ManagedViewSet, WorkspaceViewSet
from apps.workspaces.services import active_membership, lock_membership, require_manager

from . import models, serializers
from .catalog import catalog_entries
from .services import save_version
from .webhooks import MAX_BODY_BYTES, receive_webhook, rotate_secret


class ActionViewSet(WorkspaceViewSet):
    queryset = models.Action.objects.all()
    serializer_class = serializers.ActionSerializer

    @extend_schema(methods=["GET"], responses=serializers.VersionSerializer(many=True))
    @extend_schema(
        methods=["POST"],
        request=serializers.VersionSerializer,
        responses={201: serializers.VersionSerializer},
    )
    @action(detail=True, methods=["get", "post"], pagination_class=None)
    @transaction.atomic
    def versions(self, request, pk=None):
        obj = self.get_object()
        if request.method == "GET":
            return Response(
                serializers.VersionSerializer(
                    permitted_queryset(request.auth, obj.versions.order_by("-number")), many=True
                ).data
            )
        lock_membership(request)
        serializer = serializers.VersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version = save_version(
            obj,
            serializer.validated_data["source"],
            serializer.validated_data.get("input_schema", {}),
            serializer.validated_data.get("output_schema", {}),
        )
        audit(obj.workspace, request.user, "action.version_saved", obj)
        return Response(serializers.VersionSerializer(version).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        parameters=[OpenApiParameter("version", int, required=True)],
        responses=serializers.VersionSerializer,
    )
    @action(detail=True, methods=["get"])
    def version(self, request, pk=None):
        from .authoring import selected_version

        number = self.positive_query("version")
        obj = selected_version(
            workspace=request.workspace,
            token=request.auth,
            action_id=self.get_object().pk,
            number=number,
        )
        return Response(serializers.VersionSerializer(obj).data)

    def positive_query(self, name, *, required=True):
        from rest_framework.exceptions import ValidationError

        value = self.request.query_params.get(name)
        if value is None and not required:
            return None
        if value is None or not value.isascii() or not value.isdigit() or int(value) < 1:
            raise ValidationError({name: "Select a positive integer."})
        return int(value)

    @extend_schema(request=serializers.ValidateCodeRequest, responses={201: RunSerializer})
    @action(detail=False, methods=["post"], url_path="validate-code")
    def validate_code(self, request):
        from apps.runs.authoring import validate_code
        from apps.runs.serializers import RunSerializer

        active_membership(request)
        serializer = serializers.ValidateCodeRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        run = validate_code(
            workspace=request.workspace,
            actor=request.user,
            token=request.auth,
            project_id=values.pop("project"),
            key=values.pop("idempotency_key"),
            **values,
        )
        return Response(RunSerializer(run).data, status=201)

    @extend_schema(
        request=serializers.SaveActionRequest,
        responses={201: serializers.SavedActionResultSerializer},
    )
    @action(detail=False, methods=["post"], url_path="save-action")
    def save_action(self, request):
        from django.shortcuts import get_object_or_404

        from apps.agents.models import Agent

        from .authoring import save_action

        active_membership(request)
        serializer = serializers.SaveActionRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        agent = get_object_or_404(Agent, pk=values.pop("agent"), workspace=request.workspace)
        if "action" in values:
            values["action_id"] = values.pop("action")
        obj, version = save_action(
            workspace=request.workspace,
            actor=request.user,
            token=request.auth,
            agent=agent,
            **values,
        )
        return Response(
            {"action": str(obj.pk), "version": serializers.VersionSerializer(version).data},
            status=201,
        )

    @extend_schema(
        methods=["GET"],
        parameters=[
            OpenApiParameter("version", int, required=True),
            OpenApiParameter("suite_revision", int),
        ],
        responses=serializers.TestSuiteSerializer,
    )
    @extend_schema(
        methods=["POST"],
        request=serializers.TestsRequest,
        responses=serializers.TestSuiteSerializer,
    )
    @action(detail=True, methods=["get", "post"])
    def tests(self, request, pk=None):
        from .authoring import get_tests, save_tests

        obj = self.get_object()
        if request.method == "GET":
            suite = get_tests(
                workspace=request.workspace,
                token=request.auth,
                action_id=obj.pk,
                number=self.positive_query("version"),
                revision=self.positive_query("suite_revision", required=False),
            )
        else:
            serializer = serializers.TestsRequest(data=request.data)
            serializer.is_valid(raise_exception=True)
            suite = save_tests(
                workspace=request.workspace,
                actor=request.user,
                token=request.auth,
                action_id=obj.pk,
                number=serializer.validated_data["version"],
                cases=serializer.validated_data["cases"],
            )
        return Response(serializers.TestSuiteSerializer(suite).data)

    @extend_schema(request=serializers.RunTestsRequest, responses={201: RunSerializer})
    @action(detail=True, methods=["post"], url_path="run-tests")
    def run_tests(self, request, pk=None):
        from apps.runs.authoring import run_tests
        from apps.runs.serializers import RunSerializer

        active_membership(request)
        serializer = serializers.RunTestsRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        run = run_tests(
            workspace=request.workspace,
            actor=request.user,
            token=request.auth,
            action_id=pk,
            number=values["version"],
            suite_revision=values["suite_revision"],
            key=values["idempotency_key"],
        )
        return Response(RunSerializer(run).data, status=201)


class PluginViewSet(ManagedViewSet):
    queryset = models.Plugin.objects.all()
    serializer_class = serializers.PluginSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        require_manager(lock_membership(request))
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        require_manager(lock_membership(request))
        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        require_manager(lock_membership(request))
        return super().destroy(request, *args, **kwargs)

    @extend_schema(responses=serializers.CatalogEntrySerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def catalog(self, request):
        active_membership(request)
        return Response(serializers.CatalogEntrySerializer(catalog_entries(), many=True).data)


class ArtifactViewSet(WorkspaceViewSet):
    queryset = models.Artifact.objects.all()
    serializer_class = serializers.ArtifactSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]


class ScheduleViewSet(WorkspaceViewSet):
    queryset = models.Schedule.objects.all()
    serializer_class = serializers.ScheduleSerializer

    def perform_create(self, serializer):
        active_membership(self.request)
        obj = serializer.save(workspace=self.request.workspace, actor=self.request.user)
        audit(obj.workspace, self.request.user, "schedule.created", obj)


class WebhookViewSet(ManagedViewSet):
    queryset = models.Webhook.objects.select_related("action_version__action")
    serializer_class = serializers.WebhookSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    @extend_schema(responses={201: serializers.WebhookSecretSerializer})
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        membership = lock_membership(request)
        require_manager(membership)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        selected = values.pop("action")
        hook = models.Webhook.objects.create(
            **values,
            workspace=membership.workspace,
            actor=request.user,
            action_version=selected.versions.order_by("-number").first(),
            rotated_at=timezone.now(),
        )
        secret = rotate_secret(hook)
        audit(hook.workspace, request.user, "webhook.created", hook)
        return Response({"webhook": self.get_serializer(hook).data, "secret": secret}, status=201)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        require_manager(lock_membership(request))
        return super().update(request, *args, **kwargs)

    @extend_schema(request=None, responses=serializers.WebhookSecretSerializer)
    @action(detail=True, methods=["post"])
    @transaction.atomic
    def rotate(self, request, pk=None):
        require_manager(lock_membership(request))
        hook = self.get_object()
        secret = rotate_secret(hook)
        audit(hook.workspace, request.user, "webhook.secret_rotated", hook)
        return Response({"webhook": self.get_serializer(hook).data, "secret": secret})


class WebhookIngressView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        request=serializers.WebhookPayloadSerializer,
        responses={
            202: serializers.WebhookReceiptSerializer,
            200: serializers.WebhookReceiptSerializer,
        },
        parameters=[
            OpenApiParameter("X-Webhook-Secret", str, OpenApiParameter.HEADER, required=True),
            OpenApiParameter("X-Webhook-Delivery", str, OpenApiParameter.HEADER, required=True),
        ],
    )
    def post(self, request, hook_id):
        length = request.META.get("CONTENT_LENGTH", "0")
        try:
            oversized = int(length) > MAX_BODY_BYTES
        except ValueError:
            oversized = True
        body = b"x" * (MAX_BODY_BYTES + 1) if oversized else request.read(MAX_BODY_BYTES + 1)
        data, code = receive_webhook(
            hook_id=hook_id,
            workspace=request.workspace,
            secret=request.headers.get("X-Webhook-Secret", ""),
            delivery_id=request.headers.get("X-Webhook-Delivery", ""),
            body=body,
            content_type=request.content_type,
        )
        response = Response(data, status=code)
        response["Cache-Control"] = "no-store"
        return response
