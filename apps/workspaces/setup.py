from allauth.account.models import EmailAddress
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import Http404
from django.http.request import split_domain_port
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.agents.services import create_agent
from apps.core.models import InstallationSetup
from apps.execution.models import WorkspaceSettings
from apps.workspaces.models import Domain

from .models import Membership, Workspace
from .setup_serializers import (
    InstallationSetupCompleteSerializer,
    InstallationSetupErrorSerializer,
    InstallationSetupRequestSerializer,
    InstallationSetupStatusSerializer,
)


def setup_required():
    return not (
        Domain.objects.exists()
        or InstallationSetup.objects.filter(completed_at__isnull=False).exists()
    )


@transaction.atomic
def complete_setup(form):
    # The unique singleton serializes even the first two simultaneous submissions.
    InstallationSetup.objects.get_or_create(pk=1)
    state = InstallationSetup.objects.select_for_update().get(pk=1)
    if state.completed_at or Domain.objects.exists():
        raise Http404("Installation setup is already complete.")
    user = form.save(commit=False)
    user.is_staff = True
    user.is_superuser = True
    user.save()
    EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=False)
    workspace = Workspace.objects.create(name=form.cleaned_data["workspace_name"])
    Membership.objects.create(user=user, workspace=workspace, role=Membership.Role.OWNER)
    Domain.objects.create(hostname=form.cleaned_data["domain"], workspace=workspace)
    WorkspaceSettings.objects.create(workspace=workspace)
    create_agent(
        workspace=workspace,
        name=form.cleaned_data.get("project_name") or "My project",
    )
    state.completed_at = timezone.now()
    state.save(update_fields=["completed_at"])


@method_decorator(sensitive_post_parameters("password1", "password2", "api_key"), name="dispatch")
@method_decorator(never_cache, name="dispatch")
@method_decorator(ensure_csrf_cookie, name="dispatch")
@method_decorator(csrf_protect, name="dispatch")
class InstallationSetupView(APIView):
    """Create the installation owner and workspace once, with anonymous CSRF protection."""

    permission_classes = [AllowAny]

    @extend_schema(responses=InstallationSetupStatusSerializer)
    def get(self, request):
        hostname, _ = split_domain_port(request.get_host())
        return Response(
            {
                "setup_required": settings.WORKSPACE_DOMAIN_ROUTING and setup_required(),
                "hostname": hostname,
            }
        )

    @extend_schema(
        request=InstallationSetupRequestSerializer,
        responses={
            201: InstallationSetupCompleteSerializer,
            400: OpenApiResponse(
                response={
                    "type": "object",
                    "additionalProperties": {"type": "array", "items": {"type": "string"}},
                },
                description="Field validation errors, including non_field_errors.",
            ),
            (403, "text/html"): OpenApiResponse(
                response=OpenApiTypes.STR,
                description="Django rejected the request CSRF token or origin.",
            ),
            404: OpenApiResponse(
                response=InstallationSetupErrorSerializer,
                description="Installation setup is disabled or already complete.",
            ),
        },
    )
    def post(self, request):
        if not settings.WORKSPACE_DOMAIN_ROUTING or not setup_required():
            raise Http404("Installation setup is not available.")
        hostname, _ = split_domain_port(request.get_host())
        serializer = InstallationSetupRequestSerializer(
            data=request.data, context={"hostname": hostname}
        )
        serializer.is_valid(raise_exception=True)
        try:
            complete_setup(serializer.form)
        except IntegrityError:
            return Response(
                {
                    "non_field_errors": [
                        "Setup could not be completed. Reload the page and try again."
                    ]
                },
                status=400,
            )
        return Response({"setup_required": False, "login_url": "/accounts/login/"}, status=201)
