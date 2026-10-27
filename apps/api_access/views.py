from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.audit.services import audit
from apps.core.tokens import digest, issue_token
from apps.workspaces.api import ManagedViewSet
from apps.workspaces.services import lock_membership, require_manager

from . import models, serializers


class TokenViewSet(ManagedViewSet):
    queryset = models.AccessToken.objects.all()
    serializer_class = serializers.TokenSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in {"GET", "HEAD", "OPTIONS"} and isinstance(
            request.auth, models.AccessToken
        ):
            raise PermissionDenied("Use a browser session to manage API credentials.")

    @transaction.atomic
    def perform_destroy(self, instance):
        require_manager(lock_membership(self.request))
        changed = models.AccessToken.objects.filter(pk=instance.pk, revoked=False).update(
            revoked=True
        )
        if changed:
            audit(instance.workspace, self.request.user, "token.revoked", instance)

    @transaction.atomic
    @extend_schema(request=serializers.TokenSerializer, responses={201: serializers.IssuedToken})
    def create(self, request, *args, **kwargs):
        require_manager(lock_membership(request))
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value = issue_token()
        token = serializer.save(
            workspace=request.workspace, actor=request.user, digest=digest(value)
        )
        audit(request.workspace, request.user, "token.created", token)
        return Response({"id": str(token.pk), "token": value}, status=201)
