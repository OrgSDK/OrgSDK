from django.conf import settings
from django.db import models

from apps.core.models import OwnedRecord


class AuditEvent(OwnedRecord):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100, blank=True)
