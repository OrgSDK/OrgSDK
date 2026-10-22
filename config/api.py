from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.actions.views import (
    ActionViewSet,
    ArtifactViewSet,
    PluginViewSet,
    ScheduleViewSet,
    WebhookIngressView,
    WebhookViewSet,
)
from apps.agents.views import AgentViewSet, ProjectViewSet
from apps.api_access.views import TokenViewSet
from apps.audit.views import AuditListView
from apps.credentials.views import CredentialViewSet
from apps.documents.views import DocumentViewSet
from apps.runs.views import ApprovalViewSet, ConversationViewSet, RunViewSet
from apps.tables.views import RowDetailView, RowListView, TableViewSet

router = DefaultRouter()
router.register("agents", AgentViewSet)
router.register("projects", ProjectViewSet, basename="project")
router.register("actions", ActionViewSet)
router.register("credentials", CredentialViewSet)
router.register("plugins", PluginViewSet)
router.register("documents", DocumentViewSet)
router.register("tables", TableViewSet)
router.register("runs", RunViewSet)
router.register("conversations", ConversationViewSet)
router.register("artifacts", ArtifactViewSet)
router.register("approvals", ApprovalViewSet)
router.register("schedules", ScheduleViewSet)
router.register("tokens", TokenViewSet)
router.register("webhooks", WebhookViewSet)
urlpatterns = [
    path("audit/", AuditListView.as_view()),
    path("tables/<uuid:table_id>/rows/", RowListView.as_view()),
    path("tables/<uuid:table_id>/rows/<uuid:row_id>/", RowDetailView.as_view()),
    path("webhook-ingress/<uuid:hook_id>/", WebhookIngressView.as_view()),
] + router.urls
