from rest_framework import serializers

from apps.workspaces.api import WorkspaceSerializer

from . import models
from .validation import validate_run_inputs, validate_source


class RunSerializer(serializers.ModelSerializer):
    project = serializers.UUIDField(source="agent_id", read_only=True)
    source = serializers.SerializerMethodField()
    source_digest = serializers.SerializerMethodField()
    sdk_revision = serializers.SerializerMethodField()
    configuration_revision = serializers.SerializerMethodField()

    def get_source(self, obj) -> str | None:
        return obj.snapshot.get("source")

    def get_source_digest(self, obj) -> str | None:
        return obj.snapshot.get("source_digest")

    def get_sdk_revision(self, obj) -> int | None:
        return obj.snapshot.get("sdk_revision")

    def get_configuration_revision(self, obj) -> str | None:
        return obj.snapshot.get("configuration_revision")

    class Meta:
        model = models.Run
        fields = [
            "id",
            "agent",
            "project",
            "origin",
            "origin_reference",
            "conversation",
            "actor",
            "client_token",
            "source",
            "source_digest",
            "sdk_revision",
            "configuration_revision",
            "operation",
            "action_version",
            "inputs",
            "status",
            "output",
            "error",
            "retry_of",
            "cancel_requested",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class SourceField(serializers.CharField):
    def to_internal_value(self, data):
        return validate_source(data)


class RunRequest(serializers.Serializer):
    conversation = serializers.UUIDField(required=False)
    agent = serializers.UUIDField(required=False)
    project = serializers.UUIDField(required=False)
    operation = serializers.ChoiceField(
        choices=[
            ("action", "Action"),
            ("chat", "Chat"),
            ("code", "Code"),
            ("validate", "Validate"),
            ("test", "Test"),
        ]
    )
    source = SourceField(required=False, trim_whitespace=False)
    action = serializers.UUIDField(required=False)
    version = serializers.IntegerField(min_value=1, required=False)
    suite_revision = serializers.IntegerField(min_value=1, required=False)
    input_schema = serializers.JSONField(required=False)
    output_schema = serializers.JSONField(required=False)
    inputs = serializers.JSONField(default=dict)
    idempotency_key = serializers.CharField(max_length=200)

    def validate_inputs(self, value):
        return validate_run_inputs(value)

    def validate(self, attrs):
        project = attrs.pop("project", None)
        agent = attrs.get("agent")
        if project is not None and agent is not None and project != agent:
            raise serializers.ValidationError("Project and legacy agent must match.")
        if project is None and agent is None:
            raise serializers.ValidationError({"project": "Select a project."})
        attrs["agent"] = project or agent
        if attrs["operation"] in {"code", "validate"}:
            source = attrs.get("source", "")
            validate_source(source)
            if any(key in attrs for key in ("action", "version", "conversation")):
                raise serializers.ValidationError(
                    "Code runs cannot select an action, version or conversation."
                )
        elif attrs["operation"] == "test":
            if (
                not all(key in attrs for key in ("action", "version", "suite_revision"))
                or "source" in attrs
                or "conversation" in attrs
            ):
                raise serializers.ValidationError(
                    "Tests require action, version and suite_revision, "
                    "without source or conversation."
                )
        elif "source" in attrs:
            raise serializers.ValidationError("Source is only accepted for code runs.")
        if attrs["operation"] != "validate" and any(
            key in attrs for key in ("input_schema", "output_schema")
        ):
            raise serializers.ValidationError("Schemas are only accepted for validation jobs.")
        return attrs


class RetryRequest(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=200)


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.RunEvent
        fields = ["sequence", "kind", "data", "created_at"]


class ApprovalSerializer(WorkspaceSerializer):
    class Meta:
        model = models.Approval
        fields = ["id", "run", "prompt", "status", "decided_by"]
        read_only_fields = ["status", "decided_by"]


class DecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approved", "denied"])


class ConversationSerializer(WorkspaceSerializer):
    class Meta:
        model = models.Conversation
        fields = ["id", "agent", "title", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class ChatFeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ChatFeedback
        fields = ["rating", "note", "updated_at"]
        read_only_fields = ["updated_at"]


class OwnChatFeedbackSerializer(serializers.Serializer):
    feedback = ChatFeedbackSerializer(allow_null=True)
