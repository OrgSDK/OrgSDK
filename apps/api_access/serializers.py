from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.workspaces.api import WorkspaceSerializer

from . import models
from .policy import CLIENT_SCOPES, LEGACY_SCOPES


class TokenSerializer(WorkspaceSerializer):
    activity_state = serializers.SerializerMethodField()

    def get_activity_state(self, obj) -> str:
        if obj.revoked:
            return "revoked"
        if obj.last_used_at is None:
            return "never_used"
        if obj.last_used_at >= timezone.now() - timedelta(days=7):
            return "recently_used"
        return "inactive"

    class Meta:
        model = models.AccessToken
        fields = [
            "id",
            "name",
            "scopes",
            "projects",
            "action_versions",
            "revoked",
            "created_at",
            "activity_state",
            "first_used_at",
            "last_used_at",
            "request_count",
            "success_count",
            "error_count",
            "rest_request_count",
            "mcp_request_count",
            "last_transport",
            "last_outcome",
            "last_status_code",
        ]
        read_only_fields = [
            field
            for field in fields
            if field not in {"name", "scopes", "projects", "action_versions"}
        ]

    def validate_scopes(self, value):
        if not isinstance(value, list) or not value or any(not isinstance(v, str) for v in value):
            raise serializers.ValidationError("Provide a nonempty list of supported scopes.")
        scopes = set(value)
        if not (scopes <= LEGACY_SCOPES or scopes <= CLIENT_SCOPES):
            raise serializers.ValidationError("Use legacy scopes or client scopes, never both.")
        return value


class IssuedToken(serializers.Serializer):
    token = serializers.CharField()
    id = serializers.UUIDField()
