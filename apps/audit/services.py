from .models import AuditEvent


def audit(workspace, actor, kind, obj):
    AuditEvent.objects.create(workspace=workspace, actor=actor, kind=kind, object_id=str(obj.pk))
