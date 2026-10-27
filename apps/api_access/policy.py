"""Shared resource and operation authority for external scoped clients."""

from django.db.models import Q
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import AccessToken

LEGACY_SCOPES = {"read", "write", "approve"}
CLIENT_SCOPES = {
    "catalog:read",
    "code:execute",
    "actions:write",
    "actions:run",
    "actions:test",
    "runs:read",
    "runs:cancel",
}


def is_scoped(token):
    return isinstance(token, AccessToken) and bool(set(token.scopes) & CLIENT_SCOPES)


def require_scope(token, scope):
    if isinstance(token, AccessToken) and (token.revoked or scope not in token.scopes):
        raise PermissionDenied("Client scope does not permit this operation.")


def permitted_queryset(token, queryset, *, authoring=False):
    if not is_scoped(token):
        return queryset
    model = queryset.model._meta.label_lower
    workspace_field = {
        "actions.actionversion": "action__workspace_id",
        "actions.actiontestsuite": "version__action__workspace_id",
    }.get(model, "workspace_id")
    queryset = queryset.filter(**{workspace_field: token.workspace_id})
    projects = token.projects.filter(workspace_id=token.workspace_id).values("pk")
    versions = token.action_versions.filter(action__workspace_id=token.workspace_id)
    if model == "agents.agent":
        if authoring:
            return queryset.filter(pk__in=projects)
        return queryset.filter(Q(pk__in=projects) | Q(pk__in=versions.values("action__agent_id")))
    if model == "actions.action":
        allowed = Q(agent_id__in=projects)
        if not authoring:
            allowed |= Q(pk__in=versions.values("action_id"))
        return queryset.filter(allowed)
    if model == "actions.actionversion":
        if authoring:
            return queryset.filter(action__agent_id__in=projects)
        return queryset.filter(Q(action__agent_id__in=projects) | Q(pk__in=versions.values("pk")))
    if model == "actions.actiontestsuite":
        allowed = Q(version__action__agent_id__in=projects)
        if not authoring:
            allowed |= Q(version_id__in=versions.values("pk"))
        return queryset.filter(allowed)
    if model == "runs.run":
        return queryset.filter(client_token=token).filter(
            Q(agent_id__in=projects) | Q(action_version_id__in=versions.values("pk"))
        )
    return queryset.none()


def authorize_run(token, *, agent, operation, version, explicit_version=True):
    if operation in {"code", "validate"}:
        require_scope(token, "code:execute" if operation == "code" else "actions:write")
        if (
            isinstance(token, AccessToken)
            and not token.projects.filter(pk=agent.pk, workspace_id=token.workspace_id).exists()
        ):
            raise PermissionDenied("Project is outside the client grant.")
        return
    if operation == "test":
        require_scope(token, "actions:test")
    if not is_scoped(token):
        return
    require_scope(token, "actions:test" if operation == "test" else "actions:run")
    if operation not in {"action", "test"} or version is None:
        raise PermissionDenied("Client requires a permitted saved action version.")
    project_granted = token.projects.filter(pk=agent.pk, workspace_id=token.workspace_id).exists()
    if project_granted:
        return
    if (
        not explicit_version
        or not permitted_queryset(token, type(version).objects.all()).filter(pk=version.pk).exists()
    ):
        raise PermissionDenied("Client requires an explicit granted action version.")


def authorize_rest(token, request):
    """Fail closed before any REST handler, including endpoints outside viewsets."""
    if not is_scoped(token) or request.path == "/mcp/":
        return
    match = request.resolver_match
    view = match.func if match else None
    cls = getattr(view, "cls", None)
    action = getattr(view, "actions", {}).get(request.method.lower())
    owner = f"{cls.__module__}.{cls.__name__}" if cls else ""
    scope = None
    if owner in {
        "apps.agents.views.AgentViewSet",
        "apps.agents.views.ProjectViewSet",
    } and action in {"list", "retrieve", "sdk"}:
        scope = "catalog:read"
    if owner == "apps.actions.views.ActionViewSet":
        if action in {"list", "retrieve", "version", "get_tests"} or (
            action in {"versions", "tests"} and request.method == "GET"
        ):
            scope = "catalog:read"
        elif action in {
            "create",
            "update",
            "partial_update",
            "destroy",
            "versions",
            "tests",
            "validate_code",
            "save_action",
        }:
            scope = "actions:write"
        elif action == "run_tests":
            scope = "actions:test"
    if owner == "apps.runs.views.RunViewSet":
        scope = {
            "list": "runs:read",
            "retrieve": "runs:read",
            "events": "runs:read",
            "stream": "runs:read",
            "create": "actions:run",
            "retry": "actions:run",
            "cancel": "runs:cancel",
            "promote": "actions:write",
        }.get(action)
    if scope is None:
        raise PermissionDenied("Endpoint is unavailable to scoped clients.")
    if (
        action == "create"
        and owner == "apps.runs.views.RunViewSet"
        and not isinstance(request.data, dict)
    ):
        raise ValidationError("Run request must be an object.")
    if scope == "actions:run" and action == "create":
        scope = {
            "code": "code:execute",
            "validate": "actions:write",
            "test": "actions:test",
        }.get(request.data.get("operation"), scope)
    if (
        scope == "actions:run"
        and action == "retry"
        and set(token.scopes)
        & {
            "code:execute",
            "actions:write",
            "actions:test",
        }
    ):
        return
    require_scope(token, scope)


def authorize_tool(token, name):
    if not is_scoped(token):
        return
    scope = {
        "list_projects": "catalog:read",
        "get_project_sdk": "catalog:read",
        "execute_code": "code:execute",
        "get_run_events": "runs:read",
        "cancel_run": "runs:cancel",
        "list_agents": "catalog:read",
        "list_actions": "catalog:read",
        "save_action": "actions:write",
        "get_action": "catalog:read",
        "validate_code": "actions:write",
        "promote_run": "actions:write",
        "save_tests": "actions:write",
        "get_tests": "catalog:read",
        "run_tests": "actions:test",
        "run_action": "actions:run",
        "get_run": "runs:read",
    }.get(name)
    if scope is None:
        raise PermissionDenied("Tool is unavailable to scoped clients.")
    require_scope(token, scope)
