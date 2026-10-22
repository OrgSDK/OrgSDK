from rest_framework import serializers

from apps.workspaces.api import WorkspaceSerializer

from .models import Credential
from .secrets import encrypt


class CredentialSerializer(WorkspaceSerializer):
    secret = serializers.JSONField(write_only=True, required=True)

    class Meta:
        model = Credential
        fields = ["id", "name", "provider", "secret"]

    def validate_secret(self, value):
        if not isinstance(value, dict) or not value or len(str(value)) > 32_000:
            raise serializers.ValidationError("Supply a nonempty secret object under 32KB.")
        return value

    def create(self, validated_data):
        validated_data["encrypted_secret"] = encrypt(validated_data.pop("secret"))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "secret" in validated_data:
            validated_data["encrypted_secret"] = encrypt(validated_data.pop("secret"))
        return super().update(instance, validated_data)


class OAuthConnectSerializer(serializers.Serializer):
    plugin = serializers.UUIDField()
    name = serializers.CharField(max_length=100)
    client_id = serializers.CharField(max_length=500)
    client_secret = serializers.CharField(max_length=2000, write_only=True)


class OAuthRedirectSerializer(serializers.Serializer):
    authorization_url = serializers.URLField()
