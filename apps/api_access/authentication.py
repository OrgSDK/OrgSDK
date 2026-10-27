from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from apps.core.tokens import digest
from apps.workspaces.models import Membership

from .models import AccessToken


class TokenAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header:
            return None
        scheme, _, value = header.partition(" ")
        if scheme != "Bearer" or not value:
            raise AuthenticationFailed("Invalid API credential.")
        token = (
            AccessToken.objects.select_related("actor")
            .filter(digest=digest(value), revoked=False, workspace=request.workspace)
            .first()
        )
        if not token or not token.actor.is_active:
            raise AuthenticationFailed("Invalid API credential.")
        if not Membership.objects.filter(user=token.actor, workspace=token.workspace).exists():
            raise AuthenticationFailed("Membership revoked.")
        request._request.api_token_activity_id = token.pk
        from .policy import authorize_rest, is_scoped

        if is_scoped(token):
            authorize_rest(token, request)
            return token.actor, token
        needed = (
            "read"
            if request.method in {"GET", "HEAD", "OPTIONS"} or request.path == "/mcp/"
            else "write"
        )
        if needed not in token.scopes:
            raise PermissionDenied("Token scope does not permit this operation.")
        return token.actor, token


class TokenScheme(OpenApiAuthenticationExtension):
    target_class = "apps.api_access.authentication.TokenAuthentication"
    name = "apiToken"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer"}
