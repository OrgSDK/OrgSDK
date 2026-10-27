import pytest
from django.contrib import admin
from django.test import RequestFactory

from apps.audit.models import AuditEvent
from apps.audit.services import audit
from apps.workspaces.models import Workspace


@pytest.mark.django_db
def test_audit_records_keep_identity_and_survive_actor_deletion(settings, django_user_model):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    workspace = Workspace.objects.create(name="Workspace")
    actor = django_user_model.objects.create_user(username="audited", email="audited@example.test")
    audit(workspace, actor, "workspace.updated", workspace)
    event = AuditEvent.objects.get()
    assert event._meta.app_label == "audit"
    assert event.actor_id == actor.pk
    assert event.kind == "workspace.updated"
    assert event.object_id == str(workspace.pk)
    actor.delete()
    event.refresh_from_db()
    assert event.actor_id is None
    assert event.workspace_id == workspace.pk


def test_audit_administration_is_read_only():
    model_admin = admin.site._registry[AuditEvent]
    request = RequestFactory().get("/admin/")
    assert not model_admin.has_add_permission(request)
    assert not model_admin.has_change_permission(request)
    assert not model_admin.has_delete_permission(request)
