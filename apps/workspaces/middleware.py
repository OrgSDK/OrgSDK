from django.conf import settings
from django.http import JsonResponse
from django.http.request import split_domain_port
from django.shortcuts import redirect

from apps.workspaces.setup import setup_required

from .models import Domain, Workspace


class WorkspaceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.workspace = None
        if not settings.WORKSPACE_DOMAIN_ROUTING:
            return self.get_response(request)
        # Private executor routes authenticate their own service/run principals.
        if request.path.startswith(("/internal/execution/", "/static/")) or request.path in {
            "/setup/",
            "/api/v1/setup/",
            "/api/health/",
        }:
            return self.get_response(request)
        hostname, _ = split_domain_port(request.get_host())
        domain = Domain.objects.select_related("workspace").filter(hostname=hostname).first()
        workspace = domain.workspace if domain else None
        if workspace is None:
            if setup_required():
                if request.path.startswith(("/api/", "/mcp/")):
                    response = JsonResponse(
                        {"detail": "Set up your workspace to continue.", "code": "setup_required"},
                        status=503,
                    )
                    response["Cache-Control"] = "no-store"
                    return response
                return redirect("/setup/")
            if settings.WORKSPACE_SINGLE_HOST_FALLBACK:
                workspaces = list(Workspace.objects.order_by("pk")[:2])
                if len(workspaces) == 1:
                    workspace = workspaces[0]
            if workspace is None:
                return JsonResponse({"detail": "Unregistered workspace domain."}, status=404)
        request.workspace = workspace
        response = self.get_response(request)
        if request.path.startswith(("/api/", "/accounts/", "/mcp/")):
            response["Cache-Control"] = "no-store"
        return response
