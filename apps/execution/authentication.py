from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.core.tokens import digest
from apps.runs.models import Run
from apps.workspaces.models import Membership

from .models import Executor


class ServicePrincipal:
    is_authenticated = True
    is_active = True
    pk = None


class ExecutorAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme != "Bearer" or not token:
            raise AuthenticationFailed("Executor credential required.")
        executor = Executor.objects.filter(token_hash=digest(token), enabled=True).first()
        if not executor or not executor.agent_id or not executor.agent.enabled:
            raise AuthenticationFailed("Invalid executor credential.")
        return ServicePrincipal(), executor


class RunAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme != "Bearer" or not token:
            raise AuthenticationFailed("Run capability required.")
        run = (
            Run.objects.select_related("actor", "workspace", "executor")
            .filter(capability_hash=digest(token), deadline__gt=timezone.now())
            .first()
        )
        if not run or not run.actor.is_active or not run.executor or not run.executor.enabled:
            raise AuthenticationFailed("Invalid or expired run capability.")
        if run.executor.agent_id != run.agent_id or not run.agent.enabled:
            raise AuthenticationFailed("Agent executor revoked.")
        ancestor = run.parent
        while ancestor:
            if (
                ancestor.cancel_requested
                or ancestor.status in {"cancelled", "failed", "interrupted"}
                or not ancestor.agent.enabled
                or not ancestor.executor
                or not ancestor.executor.enabled
            ):
                raise AuthenticationFailed("Delegation parent revoked.")
            ancestor = ancestor.parent
        if not Membership.objects.filter(user=run.actor, workspace=run.workspace).exists():
            raise AuthenticationFailed("Membership revoked.")
        if run.lease_expires_at <= timezone.now():
            raise AuthenticationFailed("Execution lease expired.")
        if run.operation in {"validate", "test"}:
            allowed = {
                f"/internal/execution/v1/runs/{run.pk}/{operation}/"
                for operation in ("heartbeat", "events", "complete")
            }
            if request.method != "POST" or request.path not in allowed:
                raise AuthenticationFailed("Isolated jobs cannot access live capabilities.")
        request._request.workspace = run.workspace
        request.workspace = run.workspace
        return run.actor, run


class ExecutorScheme(OpenApiAuthenticationExtension):
    target_class = "apps.execution.authentication.ExecutorAuthentication"
    name = "executorToken"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer"}


class RunScheme(ExecutorScheme):
    target_class = "apps.execution.authentication.RunAuthentication"
    name = "runCapability"
