"""Run-scoped access to existing project documents."""

from rest_framework.generics import get_object_or_404

from apps.execution.project_data import bounded, page, require_resource, resource_ids

from .models import Document
from .serializers import DocumentSerializer
from .services import write_document


def execute(run, operation, params):
    documents = Document.objects.filter(
        workspace=run.workspace, pk__in=resource_ids(run, "documents")
    )
    if operation == "list_documents":
        return page(documents, DocumentSerializer, **params)
    document_id = params["document_id"]
    require_resource(run, "documents", document_id, write=operation == "write_document")
    if operation == "write_document":
        document = write_document(workspace=run.workspace, actor=run.actor, **params)
    else:
        document = get_object_or_404(documents, pk=document_id)
    return bounded(DocumentSerializer(document).data)
