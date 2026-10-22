from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Membership, Workspace


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def provision_workspace(sender, instance, created, raw=False, **kwargs):
    if settings.WORKSPACE_DOMAIN_ROUTING or not created or raw:
        return
    with transaction.atomic():
        workspace = Workspace.objects.create(name=f"{instance.username}'s workspace"[:100])
        Membership.objects.create(workspace=workspace, user=instance, role=Membership.Role.OWNER)
