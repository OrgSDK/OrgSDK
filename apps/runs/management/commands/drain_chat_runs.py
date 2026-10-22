from django.core.management.base import BaseCommand
from django.db import transaction

from apps.runs.models import Run
from apps.runs.services import cancel_descendants
from apps.workspaces.models import Workspace


class Command(BaseCommand):
    help = "Inspect retired chat work; use --apply to explicitly cancel it and revoke capabilities."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        pending = Run.objects.filter(
            operation="chat", status__in=["queued", "running", "waiting_approval"]
        )
        self.stdout.write(f"Retired chat runs requiring drain: {pending.count()}")
        if not options["apply"]:
            for run_id, workspace_id, status in pending.values_list("id", "workspace_id", "status"):
                self.stdout.write(f"  {run_id} workspace={workspace_id} status={status}")
            return
        drained = 0
        for workspace_id in pending.values_list("workspace_id", flat=True).distinct():
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=workspace_id)
                for run in pending.filter(workspace_id=workspace_id).select_for_update():
                    # Cutover is explicit: invalidate live callbacks as well as queued work.
                    cancel_descendants(run)
                    run.cancel_requested = True
                    run.status = "cancelled"
                    run.capability_hash = ""
                    run.error = "Built-in chat was retired during the explicit operator cutover."
                    run.save(
                        update_fields=[
                            "status",
                            "cancel_requested",
                            "capability_hash",
                            "error",
                            "updated_at",
                        ]
                    )
                    run.approvals.filter(status="pending").update(status="interrupted")
                    drained += 1
        self.stdout.write(f"Cancelled retired chat runs: {drained}")
