from django.conf import settings
from django.db import models

from apps.core.models import OwnedRecord


class Conversation(OwnedRecord):
    agent = models.ForeignKey("agents.Agent", on_delete=models.PROTECT)
    title = models.CharField(max_length=120, default="New conversation")


class Run(OwnedRecord):
    STATES = [
        (v, v)
        for v in [
            "queued",
            "running",
            "waiting_approval",
            "succeeded",
            "failed",
            "cancelled",
            "interrupted",
        ]
    ]
    conversation = models.ForeignKey(
        Conversation, null=True, blank=True, on_delete=models.PROTECT, related_name="turns"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children"
    )
    agent = models.ForeignKey("agents.Agent", on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action_version = models.ForeignKey("actions.ActionVersion", null=True, on_delete=models.PROTECT)
    client_token = models.ForeignKey(
        "api_access.AccessToken", null=True, blank=True, on_delete=models.PROTECT
    )
    origin = models.CharField(
        max_length=20,
        default="legacy",
        choices=[
            (value, value)
            for value in [
                "legacy",
                "browser",
                "client",
                "schedule",
                "webhook",
                "retry",
                "delegation",
            ]
        ],
    )
    origin_reference = models.CharField(max_length=200, blank=True, default="")
    idempotency_namespace = models.CharField(max_length=50, blank=True, default="")
    operation = models.CharField(
        max_length=30,
        choices=[
            ("action", "Action"),
            ("chat", "Chat"),
            ("code", "Code"),
            ("validate", "Validate"),
            ("test", "Test"),
        ],
    )
    inputs = models.JSONField(default=dict)
    snapshot = models.JSONField(default=dict)
    status = models.CharField(max_length=30, choices=STATES, default="queued")
    output = models.JSONField(default=dict)
    error = models.TextField(blank=True)
    idempotency_key = models.CharField(max_length=200)
    retry_of = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)
    cancel_requested = models.BooleanField(default=False)
    executor = models.ForeignKey("execution.Executor", null=True, on_delete=models.SET_NULL)
    lease_expires_at = models.DateTimeField(null=True)
    deadline = models.DateTimeField(null=True)
    capability_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "idempotency_namespace", "idempotency_key"],
                name="run_idempotency",
            )
        ]


class RunEvent(models.Model):
    run = models.ForeignKey(Run, on_delete=models.CASCADE, related_name="events")
    sequence = models.PositiveIntegerField()
    kind = models.CharField(max_length=50)
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["run", "sequence"], name="run_event_sequence")
        ]

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"


class Approval(OwnedRecord):
    run = models.ForeignKey(Run, on_delete=models.CASCADE, related_name="approvals")
    prompt = models.TextField()
    status = models.CharField(
        max_length=20,
        default="pending",
        choices=[
            ("pending", "Pending"),
            ("approved", "Approved"),
            ("denied", "Denied"),
            ("interrupted", "Interrupted"),
        ],
    )
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)


class ChatFeedback(models.Model):
    run = models.ForeignKey(Run, on_delete=models.CASCADE, related_name="feedback")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    rating = models.CharField(
        max_length=8, choices=[("positive", "Helpful"), ("negative", "Not helpful")]
    )
    note = models.CharField(max_length=2000, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "user"], name="chat_feedback_user")]

    def __str__(self):
        return f"Chat feedback {self.pk}"
