from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

from config.database import sqlite_database

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

DEBUG = False
SECRET_KEY = env("DJANGO_SECRET_KEY", default="django-insecure-local-development-only")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "[::1]"])
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.mfa",
    "allauth.headless",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "corsheaders",
    "apps.accounts",
    "apps.core",
    "apps.workspaces",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.api_access.activity.TokenActivityMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

if env("DATABASE_URL", default=""):
    raise ImproperlyConfigured(
        "DATABASE_URL is no longer supported. Use a fresh SQLite installation."
    )
ORGSDK_DATA_DIR = Path(env("ORGSDK_DATA_DIR", default=str(BASE_DIR / ".runtime" / "server")))
DATABASES = {"default": sqlite_database(ORGSDK_DATA_DIR / "database" / "orgsdk.sqlite3")}
CACHES = {
    "default": {
        "BACKEND": "apps.core.cache.SharedDatabaseCache",
        "LOCATION": "orgsdk_cache",
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["allauth.account.auth_backends.AuthenticationBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]
LOGIN_URL = "account_login"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
# Accounts are managed locally; email ownership is never asserted by the server.
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_EMAIL_NOTIFICATIONS = False
ACCOUNT_CHANGE_EMAIL = True
ACCOUNT_REAUTHENTICATION_REQUIRED = True
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ("browser",)
HEADLESS_FRONTEND_URLS = {"account_signup": "/accounts/signup/"}
ACCOUNT_EMAIL_SUBJECT_PREFIX = "[OrgSDK] "
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes"]
MFA_ALLOW_UNVERIFIED_EMAIL = True
SOCIALACCOUNT_LOGIN_ON_GET = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/hour",
        "user": env("API_USER_RATE", default="6000/hour"),
    },
}
SPECTACULAR_SETTINGS = {
    "ENUM_NAME_OVERRIDES": {
        "MembershipRoleEnum": [("owner", "Owner"), ("admin", "Admin"), ("member", "Member")],
        "InvitableRoleEnum": [("admin", "Admin"), ("member", "Member")],
    },
    "TITLE": "OrgSDK Platform API",
    "DESCRIPTION": (
        "Workspace APIs and the private executor contract. Session or scoped bearer authentication."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
}
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = env.bool("CORS_ALLOW_CREDENTIALS", default=False)
CORS_URLS_REGEX = r"^/api/.*$"

LANGUAGE_CODE = "en-au"
TIME_ZONE = env("DJANGO_TIME_ZONE", default="UTC")
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
MEDIA_URL = "/media/"
MEDIA_ROOT = ORGSDK_DATA_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="webmaster@localhost")
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.console.EmailBackend"}}
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"standard": {"format": "{levelname} {name}: {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "standard"}},
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", default="INFO")},
}


WORKSPACE_INVITE_BASE_URL = env(
    "WORKSPACE_INVITE_BASE_URL", default="http://localhost:5173/workspaces/invite/"
)

# Product extensions are kept separate from the upstream template defaults.
INSTALLED_APPS += [
    "apps.api_access",
    "apps.audit",
    "apps.runs",
    "apps.agents",
    "apps.credentials",
    "apps.documents",
    "apps.tables",
    "apps.actions",
    "apps.execution",
    "apps.mcp",
]
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.contrib.auth.middleware.AuthenticationMiddleware"),
    "apps.workspaces.middleware.WorkspaceMiddleware",
)
WORKSPACE_DOMAIN_ROUTING = True
WORKSPACE_SINGLE_HOST_FALLBACK = False
CREDENTIAL_ENCRYPTION_KEY = env("CREDENTIAL_ENCRYPTION_KEY", default="")
REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = [
    "rest_framework.authentication.SessionAuthentication",
    "apps.api_access.authentication.TokenAuthentication",
]

SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]["ExecutionOperationEnum"] = [
    ("action", "Action"),
    ("chat", "Chat"),
    ("code", "Code"),
    ("validate", "Validate"),
    ("test", "Test"),
]

PUBLIC_SCHEME = "http"

# Local capacity is enforced by the owning domain service under a workspace lock.
LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = env("LOCAL_EXECUTOR_BOOTSTRAP_TOKEN", default="")
PLUGIN_CATALOG_PATH = env("PLUGIN_CATALOG_PATH", default="")
PLUGIN_CATALOG_URL = env("PLUGIN_CATALOG_URL", default="https://orgsdk.ai/plugins/releases.json")
PLUGIN_MARKETPLACE_URL = env(
    "PLUGIN_MARKETPLACE_URL", default="https://orgsdk.ai/plugins/catalog.json"
)
