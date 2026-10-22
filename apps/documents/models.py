from django.db import models

from apps.core.models import OwnedRecord


class Document(OwnedRecord):
    kind = models.CharField(max_length=20, choices=[("memory", "Memory"), ("document", "Document")])
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
