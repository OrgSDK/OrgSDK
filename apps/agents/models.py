from django.db import models

from apps.core.models import OwnedRecord


class Agent(OwnedRecord):
    name = models.CharField(max_length=100)
    instructions = models.TextField(blank=True)
    model = models.CharField(max_length=100, default="", blank=True)
    credential = models.ForeignKey(
        "credentials.Credential", null=True, blank=True, on_delete=models.SET_NULL
    )
    enabled = models.BooleanField(default=True)

    readable_tables = models.ManyToManyField("tables.WorkspaceTable", blank=True, related_name="+")
    writable_tables = models.ManyToManyField("tables.WorkspaceTable", blank=True, related_name="+")
    readable_documents = models.ManyToManyField("documents.Document", blank=True, related_name="+")
    writable_documents = models.ManyToManyField("documents.Document", blank=True, related_name="+")
