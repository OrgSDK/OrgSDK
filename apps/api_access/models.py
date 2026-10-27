from django.conf import settings
from django.db import models

from apps.core.models import OwnedRecord


class AccessToken(OwnedRecord):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    digest = models.CharField(max_length=64, unique=True)
    scopes = models.JSONField(default=list)
    projects = models.ManyToManyField("agents.Agent", blank=True)
    action_versions = models.ManyToManyField("actions.ActionVersion", blank=True)
    revoked = models.BooleanField(default=False)
    first_used_at = models.DateTimeField(null=True, editable=False)
    last_used_at = models.DateTimeField(null=True, editable=False)
    request_count = models.PositiveBigIntegerField(default=0, editable=False)
    success_count = models.PositiveBigIntegerField(default=0, editable=False)
    error_count = models.PositiveBigIntegerField(default=0, editable=False)
    rest_request_count = models.PositiveBigIntegerField(default=0, editable=False)
    mcp_request_count = models.PositiveBigIntegerField(default=0, editable=False)
    last_transport = models.CharField(max_length=4, blank=True, editable=False)
    last_outcome = models.CharField(max_length=7, blank=True, editable=False)
    last_status_code = models.PositiveSmallIntegerField(null=True, editable=False)
