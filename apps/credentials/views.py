from django.shortcuts import redirect
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.workspaces.api import ManagedViewSet

from .models import Credential
from .oauth import begin_connection, finish_connection
from .serializers import CredentialSerializer, OAuthConnectSerializer, OAuthRedirectSerializer


class CredentialViewSet(ManagedViewSet):
    queryset = Credential.objects.all()
    serializer_class = CredentialSerializer

    @extend_schema(request=OAuthConnectSerializer, responses=OAuthRedirectSerializer)
    @action(detail=False, methods=["post"], url_path="oauth-connect")
    def oauth_connect(self, request):
        serializer = OAuthConnectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        url = begin_connection(request, serializer.validated_data)
        return Response({"authorization_url": url}, headers={"Cache-Control": "no-store"})

    @extend_schema(exclude=True)
    @action(detail=False, methods=["get"], url_path="oauth-callback")
    def oauth_callback(self, request):
        if request.query_params.get("error"):
            raise ValidationError("Authorization was declined. Return to Plugins to try again.")
        code, state = request.query_params.get("code"), request.query_params.get("state")
        if not code or not state:
            raise ValidationError("Missing OAuth authorization code or state.")
        finish_connection(request, state, code)
        response = redirect("/plugins/")
        response["Cache-Control"] = "no-store"
        response["Referrer-Policy"] = "no-referrer"
        return response
