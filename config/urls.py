from allauth.account.decorators import secure_admin_login
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from apps.accounts.views import CurrentUserView, SessionView
from apps.core.views import health
from apps.workspaces.setup import InstallationSetupView

# Keep admin sign-in inside allauth's authentication, rate-limit and MFA flow.
admin.site.login = secure_admin_login(admin.site.login)

urlpatterns = [
    path("api/v1/setup/", InstallationSetupView.as_view(), name="installation-setup"),
    path("mcp/", include("apps.mcp.urls")),
    path("api/v1/", include("config.api")),
    path("internal/execution/v1/", include("apps.execution.urls")),
    path("api/v1/workspaces/", include("apps.workspaces.urls")),
    path("api/health/", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.headless_urls")),
    path("accounts/", include("apps.accounts.urls")),
    path("api/v1/session/", SessionView.as_view(), name="api-session"),
    path("api/v1/me/", CurrentUserView.as_view(), name="api-me"),
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="api-schema"), name="api-docs"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="api-schema"), name="api-redoc"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    if getattr(settings, "ENABLE_DEBUG_TOOLBAR", False):
        from debug_toolbar.toolbar import debug_toolbar_urls

        urlpatterns += debug_toolbar_urls()
