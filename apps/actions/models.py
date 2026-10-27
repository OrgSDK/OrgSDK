import uuid

from django.conf import settings
from django.db import models

from apps.core.models import OwnedRecord


class Action(OwnedRecord):
    agent = models.ForeignKey("agents.Agent", on_delete=models.CASCADE, related_name="actions")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)


class ActionVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.ForeignKey(Action, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    source = models.TextField()
    input_schema = models.JSONField(default=dict)
    output_schema = models.JSONField(default=dict)
    validation_mode = models.CharField(max_length=20, default="legacy")
    sdk_contract = models.JSONField(default=dict)
    promoted_from = models.ForeignKey("runs.Run", null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["action", "number"], name="action_version")]

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"


class ActionTestSuite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.ForeignKey(ActionVersion, on_delete=models.CASCADE, related_name="test_suites")
    number = models.PositiveIntegerField()
    cases = models.JSONField()
    digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["version", "number"], name="action_test_suite_revision")
        ]

    def __str__(self):
        return f"Test suite {self.pk}"


class Plugin(OwnedRecord):
    agent = models.ForeignKey(
        "agents.Agent", null=True, blank=True, on_delete=models.CASCADE, related_name="plugins"
    )
    release_metadata = models.JSONField(default=dict, blank=True)
    package_url = models.URLField(max_length=2000, blank=True)
    distribution = models.CharField(max_length=20, default="inline")
    configuration = models.JSONField(default=dict, blank=True)
    slug = models.SlugField()
    version = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    source = models.TextField()
    digest = models.CharField(max_length=64)
    enabled = models.BooleanField(default=True)
    credential = models.ForeignKey(
        "credentials.Credential", null=True, blank=True, on_delete=models.SET_NULL
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent", "slug"], name="agent_installed_plugin")
        ]


class Artifact(OwnedRecord):
    run = models.ForeignKey("runs.Run", on_delete=models.CASCADE, related_name="artifacts")
    name = models.CharField(max_length=200)
    content = models.TextField()
    media_type = models.CharField(max_length=100, default="text/plain")


class Schedule(OwnedRecord):
    action = models.ForeignKey("actions.Action", on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    cron = models.CharField(max_length=100)
    inputs = models.JSONField(default=dict)
    enabled = models.BooleanField(default=True)
    next_run_at = models.DateTimeField()


class Webhook(OwnedRecord):
    name = models.CharField(max_length=100)
    action_version = models.ForeignKey(ActionVersion, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    secret_hash = models.CharField(max_length=64)
    enabled = models.BooleanField(default=True)
    rotated_at = models.DateTimeField()
    last_received_at = models.DateTimeField(null=True, blank=True)
    last_accepted_at = models.DateTimeField(null=True, blank=True)
    last_rejection = models.CharField(max_length=40, blank=True)
    last_rejected_at = models.DateTimeField(null=True, blank=True)


class WebhookDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook = models.ForeignKey(Webhook, on_delete=models.CASCADE, related_name="deliveries")
    delivery_id = models.CharField(max_length=128)
    payload_hash = models.CharField(max_length=64)
    received_at = models.DateTimeField(auto_now_add=True)
    outcome = models.CharField(max_length=40)
    run = models.ForeignKey("runs.Run", null=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["webhook", "delivery_id"], name="webhook_delivery_id")
        ]

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"
