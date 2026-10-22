from django.db import transaction
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.workspaces.api import WorkspaceSerializer

from .models import Agent


class RunnerStatusSerializer(serializers.Serializer):
    registered = serializers.BooleanField()
    enabled = serializers.BooleanField()
    locally_managed = serializers.BooleanField()
    last_seen_at = serializers.DateTimeField(allow_null=True)


class AgentSerializer(WorkspaceSerializer):
    def get_fields(self):
        from apps.api_access.policy import is_scoped

        fields = super().get_fields()
        request = self.context.get("request")
        if is_scoped(getattr(request, "auth", None)):
            return {
                key: value
                for key, value in fields.items()
                if key in {"id", "name", "enabled", "runner"}
            }
        return fields

    runner = serializers.SerializerMethodField()
    plugins = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    @extend_schema_field(RunnerStatusSerializer)
    def get_runner(self, obj):
        executor = getattr(obj, "executor", None)
        return {
            "registered": bool(executor),
            "enabled": bool(executor and executor.enabled),
            "locally_managed": bool(executor and executor.locally_managed),
            "last_seen_at": executor.last_seen_at if executor else None,
        }

    def validate(self, attrs):
        if {"model", "instructions", "credential"} & self.initial_data.keys():
            raise serializers.ValidationError("Model and reasoning configuration is retired.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        from .services import create_agent

        self.lock_grant_management(validated_data)
        return create_agent(**validated_data)

    def lock_grant_management(self, values):
        from apps.workspaces.services import lock_membership, require_manager

        membership = lock_membership(self.context["request"])
        if any(key.startswith(("readable_", "writable_")) for key in values):
            if self.context["request"].auth is not None:
                raise PermissionDenied(
                    "Resource grants require a workspace manager browser session."
                )
            require_manager(membership)

    @transaction.atomic
    def update(self, instance, validated_data):
        self.lock_grant_management(validated_data)
        return super().update(instance, validated_data)

    class Meta:
        model = Agent
        fields = [
            "id",
            "name",
            "instructions",
            "model",
            "credential",
            "plugins",
            "enabled",
            "runner",
            "readable_tables",
            "writable_tables",
            "readable_documents",
            "writable_documents",
        ]


class ProjectSerializer(AgentSerializer):
    """Project management deliberately excludes legacy reasoning configuration."""

    class Meta(AgentSerializer.Meta):
        fields = [
            field
            for field in AgentSerializer.Meta.fields
            if field not in {"instructions", "model", "credential"}
        ]


class SDKPluginSerializer(serializers.Serializer):
    namespace = serializers.CharField(allow_null=True)
    available = serializers.BooleanField()
    slug = serializers.CharField()
    version = serializers.CharField()
    digest = serializers.CharField()
    metadata_complete = serializers.BooleanField()
    tools = serializers.ListField(child=serializers.DictField(), allow_null=True)


class SDKResourceModesSerializer(serializers.Serializer):
    read = serializers.ListField(child=serializers.UUIDField())
    write = serializers.ListField(child=serializers.UUIDField())


class SDKResourcesSerializer(serializers.Serializer):
    tables = SDKResourceModesSerializer()
    documents = SDKResourceModesSerializer()


class ProjectSDKSerializer(serializers.Serializer):
    project = serializers.UUIDField()
    protocol_version = serializers.IntegerField()
    sdk_revision = serializers.IntegerField()
    configuration_revision = serializers.CharField()
    resources = SDKResourcesSerializer()
    limits = serializers.DictField(child=serializers.IntegerField())
    builtins = serializers.ListField(child=serializers.CharField())
    plugins = SDKPluginSerializer(many=True)
    notes = serializers.CharField()
    example = serializers.CharField()
