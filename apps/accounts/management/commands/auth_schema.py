"""Export the installed allauth contract, filtered to supported account endpoints."""

import json

from allauth.headless.spec.internal.schema import get_schema
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Write the browser authentication OpenAPI contract to stdout."

    def handle(self, *args, **options):
        schema = get_schema()
        schema["paths"]["/api/auth/browser/v1/account/email"].pop("put", None)
        # allauth 65.20 omits this documented runtime success from its bundled spec.
        schema["paths"]["/api/auth/browser/v1/account/authenticators/recovery-codes"]["post"][
            "responses"
        ]["200"] = {"$ref": "#/components/responses/RecoveryCodes"}
        self.stdout.write(json.dumps(schema, indent=2) + "\n", ending="")
