import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.execution.models import WorkspaceSettings
from apps.workspaces.models import Domain, Membership, Workspace


class Command(BaseCommand):
    help = "Idempotently provision a workspace on a registered hostname. Never resets passwords."

    def add_arguments(self, parser):
        parser.add_argument("--domain", required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument(
            "--owner", required=True, help="Owner email; existing user or unusable password."
        )
        parser.add_argument("--pool", default="shared")

    @transaction.atomic
    def handle(self, *args, **options):
        hostname = options["domain"].lower().rstrip(".")
        if len(hostname) > 253 or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*",
            hostname,
        ):
            raise CommandError("Supply a hostname without scheme, port or path.")
        existing = Domain.objects.select_related("workspace").filter(hostname=hostname).first()
        if existing:
            owner = (
                existing.workspace.memberships.filter(role="owner").select_related("user").first()
            )
            if not owner or owner.user.email.casefold() != options["owner"].casefold():
                raise CommandError("Domain already belongs to another owner.")
            self.stdout.write(f"Workspace already provisioned: {existing.workspace_id}")
            return
        user, created = get_user_model().objects.get_or_create(
            email=options["owner"].lower(), defaults={"username": options["owner"].lower()}
        )
        if created:
            user.set_unusable_password()
            user.save()
        workspace = Workspace.objects.create(name=options["name"])
        Membership.objects.create(workspace=workspace, user=user, role="owner")
        Domain.objects.create(workspace=workspace, hostname=hostname)
        WorkspaceSettings.objects.create(workspace=workspace, execution_pool=options["pool"])
        self.stdout.write(
            f"Provisioned workspace {workspace.pk} for {hostname}. "
            "Set owner password with changepassword."
        )
