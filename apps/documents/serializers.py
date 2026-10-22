from rest_framework import serializers

from apps.workspaces.api import WorkspaceSerializer

from .models import Document


class DocumentSerializer(WorkspaceSerializer):
    content = serializers.CharField(max_length=200_000, allow_blank=True)

    class Meta:
        model = Document
        fields = ["id", "kind", "title", "content"]
