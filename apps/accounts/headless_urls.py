"""Expose only the supported browser account flows, using allauth's own views."""

from allauth.headless.constants import Client
from allauth.headless.spec.views import OpenAPIJSONView, OpenAPIYAMLView
from allauth.headless.urls import build_urlpatterns
from django.contrib.admin.views.decorators import staff_member_required
from django.urls import URLResolver, include, path
from django.views.decorators.cache import never_cache

from .headless import LocalEmailView

SUPPORTED = {
    "current_session",
    "reauthenticate",
    "login",
    "signup",
    "change_password",
    "manage_email",
    "authenticate",
    "authenticators",
    "manage_totp",
    "manage_recovery_codes",
}


def supported_patterns(patterns):
    selected = []
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            children = supported_patterns(pattern.url_patterns)
            if children:
                selected.append(
                    path(
                        str(pattern.pattern),
                        include((children, pattern.app_name), namespace=pattern.namespace),
                    )
                )
        elif pattern.name in SUPPORTED:
            if pattern.name == "manage_email":
                pattern = path(
                    str(pattern.pattern),
                    LocalEmailView.as_api_view(client=Client.BROWSER),
                    name=pattern.name,
                )
            selected.append(
                path(str(pattern.pattern), never_cache(pattern.callback), name=pattern.name)
            )
    return selected


app_name = "headless"
urlpatterns = [
    path(
        "browser/",
        include(
            (supported_patterns(build_urlpatterns(Client.BROWSER)), "headless"), namespace="browser"
        ),
    ),
    path(
        "openapi.json",
        never_cache(staff_member_required(OpenAPIJSONView.as_view())),
        name="openapi_json",
    ),
    path(
        "openapi.yaml",
        never_cache(staff_member_required(OpenAPIYAMLView.as_view())),
        name="openapi_yaml",
    ),
]
