"""Local dedicated Docker deployment. Never use this HTTP profile on a public host."""

from .base import *  # noqa: F403
from .base import env

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = False
PUBLIC_SCHEME = "http"
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.console.EmailBackend"}}

# Local aliases share the sole configured workspace; authorization still requires membership.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["*"])
WORKSPACE_SINGLE_HOST_FALLBACK = env.bool("WORKSPACE_SINGLE_HOST_FALLBACK", default=True)
