from django.db import transaction
from django.urls import include, path
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.routers import SimpleRouter
from rest_framework.views import APIView

from apps.actions.views import ActionViewSet, ArtifactViewSet
from apps.agents.views import AgentViewSet
from apps.documents.views import DocumentViewSet
from apps.runs.services import TERMINAL
from apps.runs.views import ApprovalViewSet, RunViewSet

from .authentication import RunAuthentication
from .project_data import OperationSerializer


def require_live_data_run(run):
    # Cancellation holds the workspace lock, which callers acquired before this refresh.
    run.refresh_from_db(fields=["status", "cancel_requested", "deadline", "lease_expires_at"])
    now = timezone.now()
    if (
        run.status in TERMINAL
        or run.cancel_requested
        or run.deadline is None
        or run.deadline <= now
        or run.lease_expires_at is None
        or run.lease_expires_at <= now
    ):
        raise PermissionDenied("Run is no longer active.")


class CapabilityMixin:
    authentication_classes = [RunAuthentication]
    throttle_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        run = request.auth
        if run.status in TERMINAL or run.cancel_requested:
            raise PermissionDenied("Run is no longer active.")
        if getattr(self, "action", "") in {"decide", "feedback"}:
            raise PermissionDenied("Executors cannot decide approvals or access private feedback.")

    def get_queryset(self):
        query = super().get_queryset()
        if getattr(self, "swagger_fake_view", False):
            return query.none()
        run = self.request.auth
        name = query.model._meta.model_name
        if name in {"artifact", "approval"}:
            return query.filter(run=run)
        if name == "run":
            return query.filter(pk=run.pk)
        agents = [agent["id"] for agent in run.snapshot["agents"]]
        if name == "agent":
            return query.filter(pk__in=agents)
        if name == "action":
            return query.filter(agent_id__in=agents)
        return query

    def perform_create(self, serializer):
        if (
            "run" in serializer.validated_data
            and serializer.validated_data["run"] != self.request.auth
        ):
            raise PermissionDenied("Capability is bound to another run.")
        super().perform_create(serializer)


class Agents(CapabilityMixin, AgentViewSet):
    http_method_names = ["get", "head", "options"]


class Actions(CapabilityMixin, ActionViewSet):
    http_method_names = ["get", "head", "options"]


class Documents(CapabilityMixin, DocumentViewSet):
    def is_resource_scoped(self):
        run = self.request.auth
        return (
            run.operation == "code"
            or run.client_token_id is not None
            or any("resources" in agent for agent in run.snapshot.get("agents", []))
        )

    def get_queryset(self):
        from .project_data import resource_ids

        query = super().get_queryset()
        if self.is_resource_scoped():
            query = query.filter(pk__in=resource_ids(self.request.auth, "documents"))
        return query

    def perform_create(self, serializer):
        if self.is_resource_scoped():
            raise PermissionDenied("Runs cannot create documents; select human-managed documents.")
        super().perform_create(serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        if not self.is_resource_scoped():
            return super().perform_update(serializer)
        from apps.documents.services import write_document
        from apps.tables.services import lock_actor

        from .project_data import require_resource

        run = self.request.auth
        lock_actor(run.workspace, run.actor)
        require_live_data_run(run)
        require_resource(run, "documents", serializer.instance.pk, write=True)
        if (
            "kind" in serializer.validated_data
            and serializer.validated_data["kind"] != serializer.instance.kind
        ):
            raise PermissionDenied("Runs cannot change document kinds.")
        values = {
            key: value
            for key, value in serializer.validated_data.items()
            if key in {"title", "content"}
        }
        serializer.instance = write_document(
            workspace=run.workspace, actor=run.actor, document_id=serializer.instance.pk, **values
        )

    def perform_destroy(self, instance):
        if self.is_resource_scoped():
            raise PermissionDenied("Runs cannot delete documents.")
        super().perform_destroy(instance)


class ProjectData(CapabilityMixin, APIView):
    @extend_schema(request=OperationSerializer, responses={200: dict})
    @transaction.atomic
    def post(self, request):
        from apps.documents.execution import execute as documents
        from apps.tables.execution import execute as tables
        from apps.tables.services import lock_actor

        from .project_data import OperationSerializer

        serializer = OperationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        params = dict(serializer.validated_data)
        operation = params.pop("operation")
        run = request.auth
        lock_actor(run.workspace, run.actor)
        require_live_data_run(run)
        handler = (
            documents if operation.endswith("document") or operation == "list_documents" else tables
        )
        return Response(handler(run, operation, params))


class Artifacts(CapabilityMixin, ArtifactViewSet):
    pass


class Approvals(CapabilityMixin, ApprovalViewSet):
    pass


class Runs(CapabilityMixin, RunViewSet):
    http_method_names = ["get", "head", "options"]


router = SimpleRouter()
for name, cls in [
    ("agents", Agents),
    ("actions", Actions),
    ("documents", Documents),
    ("artifacts", Artifacts),
    ("approvals", Approvals),
    ("runs", Runs),
]:
    router.register(name, cls, basename=f"execution-{name}")
urlpatterns = [
    path("product/project-data/", ProjectData.as_view(), name="execution-project-data"),
    path("product/", include(router.urls)),
]
