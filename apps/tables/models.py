import uuid

from django.db import models

from apps.core.models import OwnedRecord


class WorkspaceTable(OwnedRecord):
    name = models.CharField(max_length=120)
    columns = models.JSONField(default=list)
    revision = models.PositiveIntegerField(default=1)


class TableRow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    table = models.ForeignKey(WorkspaceTable, on_delete=models.CASCADE, related_name="rows")
    values = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Row {self.pk}"
