import os

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.agents.models import Agent
from apps.core.tokens import digest
from apps.execution.models import Executor
from apps.execution.services import revoke_executor


class Command(BaseCommand):
    help = "Register or rotate an executor credential from EXECUTOR_TOKEN; never prints secrets."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--agent", required=True)
        parser.add_argument("--pool", default="shared")

    @transaction.atomic
    def handle(self, *args, **options):
        token = os.environ.get("EXECUTOR_TOKEN", "")
        if len(token) < 32:
            raise CommandError("Set EXECUTOR_TOKEN to a random value of at least 32 characters.")
        try:
            agent = Agent.objects.get(pk=options["agent"])
        except (Agent.DoesNotExist, ValueError, ValidationError) as error:
            raise CommandError("Choose an existing agent UUID.") from error
        previous = Executor.objects.filter(agent=agent).first()
        if previous:
            revoke_executor(previous)
        executor, _ = Executor.objects.update_or_create(
            agent=agent,
            defaults={
                "name": options["name"],
                "pool": options["pool"],
                "token_hash": digest(token),
                "enabled": True,
                "locally_managed": False,
            },
        )
        self.stdout.write(f"Registered {executor.name} in pool {executor.pool}.")
