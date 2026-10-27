from django.apps import AppConfig


class ApiAccessConfig(AppConfig):
    name = "apps.api_access"

    def ready(self):
        from . import authentication  # noqa: F401
