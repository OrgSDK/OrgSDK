import uuid

from django.db import models
from django.utils import timezone


class BackgroundJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        SUCCEEDED = "succeeded"
        FAILED = "failed"

    task = models.CharField(max_length=64)
    arguments = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=Status, default=Status.QUEUED)
    available_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    occurrence = models.CharField(max_length=100, unique=True, null=True, blank=True)
    last_error = models.CharField(max_length=200, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "available_at"])]

    def __str__(self):
        return f"{self.task}: {self.status}"


class InstallationSetup(models.Model):
    """One-time setup marker and database lock for concurrent setup requests."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="single_installation")]

    def __str__(self):
        return "Installation setup"


class OwnedRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"
