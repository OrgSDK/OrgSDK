from django.db import models

from apps.core.models import OwnedRecord


class Credential(OwnedRecord):
    name = models.CharField(max_length=100)
    provider = models.CharField(max_length=100)
    encrypted_secret = models.TextField()


class OAuthAttempt(OwnedRecord):
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE)
    plugin = models.ForeignKey("actions.Plugin", on_delete=models.CASCADE)
    state_digest = models.CharField(max_length=64, unique=True)
    session_digest = models.CharField(max_length=64)
    encrypted_payload = models.TextField()
    expires_at = models.DateTimeField()
