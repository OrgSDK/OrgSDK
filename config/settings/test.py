import tempfile
from pathlib import Path

from config.database import sqlite_database

from .base import *  # noqa: F403
from .base import BASE_DIR, MIDDLEWARE, env

SECRET_KEY = "test-only-key"
ALLOWED_HOSTS = ["testserver", "localhost"]
_database_directory = tempfile.TemporaryDirectory(prefix="orgsdk-tests-")
_database_path = env(
    "TEST_SQLITE_PATH", default=str(Path(_database_directory.name) / "test.sqlite3")
)
DATABASES = {"default": sqlite_database(_database_path)}
DATABASES["default"]["TEST"] = {"NAME": _database_path}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}}
MIDDLEWARE = [item for item in MIDDLEWARE if item != "whitenoise.middleware.WhiteNoiseMiddleware"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

STATICFILES_DIRS = [BASE_DIR / "static"]

# Upstream contract tests retain their original fixture setup. Product tests enable routing.
WORKSPACE_DOMAIN_ROUTING = False

PLUGIN_CATALOG_URL = ""
PLUGIN_MARKETPLACE_URL = ""
