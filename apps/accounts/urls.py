"""Named frontend locations used by Django and allauth redirects."""

from django.http import HttpResponseNotFound
from django.urls import path


def frontend_page(request, **kwargs):
    return HttpResponseNotFound("Open this page through the application frontend.")


urlpatterns = [
    path("login/", frontend_page, name="account_login"),
    path("signup/", frontend_page, name="account_signup"),
    path("logout/", frontend_page, name="account_logout"),
    path("email/", frontend_page, name="account_email"),
    path("password/change/", frontend_page, name="account_change_password"),
    path("password/reset/", frontend_page, name="account_reset_password"),
    path("reauthenticate/", frontend_page, name="account_reauthenticate"),
    path("inactive/", frontend_page, name="account_inactive"),
    path("2fa/", frontend_page, name="mfa_index"),
    path("2fa/authenticate/", frontend_page, name="mfa_authenticate"),
    path("2fa/reauthenticate/", frontend_page, name="mfa_reauthenticate"),
]
