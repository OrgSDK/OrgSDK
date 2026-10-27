from django.db import transaction

from apps.workspaces.api import WorkspaceViewSet

from .models import Document
from .serializers import DocumentSerializer
from .services import create_document, delete_document, write_document


class DocumentViewSet(WorkspaceViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer

    def perform_create(self, serializer):
        serializer.instance = create_document(
            workspace=self.request.workspace,
            actor=self.request.user,
            **serializer.validated_data,
        )

    @transaction.atomic
    def perform_update(self, serializer):
        values = dict(serializer.validated_data)
        kind = values.pop("kind", serializer.instance.kind)
        serializer.instance = write_document(
            workspace=self.request.workspace,
            actor=self.request.user,
            document_id=serializer.instance.pk,
            **values,
        )
        if kind != serializer.instance.kind:
            serializer.instance.kind = kind
            serializer.instance.save(update_fields=["kind"])

    def perform_destroy(self, instance):
        delete_document(
            workspace=self.request.workspace,
            actor=self.request.user,
            document_id=instance.pk,
        )
