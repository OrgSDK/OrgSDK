from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "Run the PostgreSQL job worker and its built-in periodic scheduler."

    def add_arguments(self, parser):
        parser.add_argument("--concurrency", type=int, default=4)

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            raise CommandError(
                "run_worker requires PostgreSQL; SQLite is supported for unit tests only."
            )
        if options["concurrency"] < 1:
            raise CommandError("--concurrency must be positive.")
        call_command("procrastinate", "worker", "--concurrency", str(options["concurrency"]))
