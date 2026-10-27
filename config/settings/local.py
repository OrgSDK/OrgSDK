from .base import *  # noqa: F403
from .base import INSTALLED_APPS, MIDDLEWARE, env

DEBUG = True
MIDDLEWARE = [item for item in MIDDLEWARE if item != "whitenoise.middleware.WhiteNoiseMiddleware"]
INSTALLED_APPS = [*INSTALLED_APPS, "django_extensions"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

ENABLE_DEBUG_TOOLBAR = env.bool("ENABLE_DEBUG_TOOLBAR", default=False)
if ENABLE_DEBUG_TOOLBAR:
    INSTALLED_APPS = [*INSTALLED_APPS, "debug_toolbar"]
    MIDDLEWARE = ["debug_toolbar.middleware.DebugToolbarMiddleware", *MIDDLEWARE]
    INTERNAL_IPS = ["127.0.0.1", "::1"]

# The loopback-only Django server receives the browser host from the Next proxy.
USE_X_FORWARDED_HOST = True

# Local aliases share the sole configured workspace; authorization still requires membership.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["*"])
WORKSPACE_SINGLE_HOST_FALLBACK = env.bool("WORKSPACE_SINGLE_HOST_FALLBACK", default=True)
