import uuid

from django.db import models


class Executor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agent = models.OneToOneField(
        "agents.Agent", null=True, blank=True, on_delete=models.CASCADE, related_name="executor"
    )
    registration_nonce = models.UUIDField(default=uuid.uuid4, editable=False)
    locally_managed = models.BooleanField(default=False)
    name = models.CharField(max_length=100, unique=True)
    pool = models.CharField(max_length=100, default="shared")
    token_hash = models.CharField(max_length=64, unique=True)
    capabilities = models.JSONField(default=list)
    protocol_version = models.PositiveIntegerField(default=1)
    last_seen_at = models.DateTimeField(null=True)
    enabled = models.BooleanField(default=True)

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"


class WorkspaceSettings(models.Model):
    workspace = models.OneToOneField("workspaces.Workspace", on_delete=models.CASCADE)
    execution_pool = models.CharField(max_length=100, default="shared")
    enabled = models.BooleanField(default=True)
    max_concurrent_runs = models.PositiveIntegerField(default=4)

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"
