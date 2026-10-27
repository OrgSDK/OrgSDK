"""Workspace document mutation rules shared by session and run callers."""

from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404

from apps.audit.services import audit
from apps.tables.services import lock_actor, safe_text

from .models import Document


def validate_document(values):
    for key, value in values.items():
        limit = 200 if key == "title" else 200_000
        if not safe_text(value, limit) or (key == "content" and len(value.encode("utf-8")) > limit):
            raise ValidationError({key: f"Use valid text of at most {limit} UTF-8 bytes."})
    return values


@transaction.atomic
def write_document(*, workspace, actor, document_id, **values):
    lock_actor(workspace, actor)
    document = get_object_or_404(Document, pk=document_id, workspace=workspace)
    validate_document(values)
    for key, value in values.items():
        setattr(document, key, value)
    document.save()
    audit(workspace, actor, "document.updated", document)
    return document


@transaction.atomic
def create_document(*, workspace, actor, kind, **values):
    lock_actor(workspace, actor)
    validate_document(values)
    document = Document.objects.create(workspace=workspace, kind=kind, **values)
    audit(workspace, actor, "document.created", document)
    return document


@transaction.atomic
def delete_document(*, workspace, actor, document_id):
    lock_actor(workspace, actor)
    document = get_object_or_404(Document, pk=document_id, workspace=workspace)
    audit(workspace, actor, "document.deleted", document)
    document.delete()
