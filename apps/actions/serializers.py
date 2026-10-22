from datetime import UTC, datetime

from croniter import croniter
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from jsonschema import Draft202012Validator
from rest_framework import serializers

from apps.agents.models import Agent
from apps.workspaces.api import WorkspaceSerializer

from . import models
from .authoring import bounded_json, validate_schema
from .catalog import catalog_release
from .services import source_digest


class ActionSerializer(WorkspaceSerializer):
    project = serializers.PrimaryKeyRelatedField(
        source="agent",
        queryset=Agent.objects.all(),
        required=False,
    )

    def get_fields(self):
        fields = super().get_fields()
        fields["agent"].required = False
        return fields

    def validate(self, attrs):
        if self.instance is None and "agent" not in attrs:
            raise serializers.ValidationError({"project": "Select a project."})
        if (
            "agent" in self.initial_data
            and "project" in self.initial_data
            and str(self.initial_data["agent"]) != str(self.initial_data["project"])
        ):
            raise serializers.ValidationError("Project and legacy agent must match.")
        return attrs

    class Meta:
        model = models.Action
        fields = ["id", "agent", "project", "name", "description", "enabled"]


class VersionSerializer(serializers.ModelSerializer):
    source = serializers.CharField(max_length=200_000, trim_whitespace=False)

    class Meta:
        model = models.ActionVersion
        fields = [
            "id",
            "number",
            "source",
            "input_schema",
            "output_schema",
            "validation_mode",
            "sdk_contract",
            "promoted_from",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "number",
            "validation_mode",
            "sdk_contract",
            "promoted_from",
            "created_at",
        ]

    def validate(self, attrs):
        bounded_json(self.initial_data)
        return attrs

    def validate_input_schema(self, value):
        return validate_schema(value)

    def validate_output_schema(self, value):
        return validate_schema(value)


class SavedActionResultSerializer(serializers.Serializer):
    action = serializers.UUIDField()
    version = VersionSerializer()


class TestMockSerializer(serializers.Serializer):
    tool = serializers.RegexField(r"^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$", max_length=201)
    args = serializers.ListField(child=serializers.JSONField(allow_null=True), max_length=30)
    result = serializers.JSONField(required=False, allow_null=True)
    error = serializers.CharField(required=False)
    times = serializers.IntegerField(min_value=1, max_value=100, default=1)


class TestCaseSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    inputs = serializers.DictField(child=serializers.JSONField(allow_null=True))
    expected = serializers.JSONField(allow_null=True)
    mocks = TestMockSerializer(many=True, required=False, max_length=100)
    forbidden_calls = serializers.ListField(
        child=serializers.CharField(max_length=201), max_length=100, required=False
    )


@extend_schema_field(serializers.ListField(child=TestCaseSerializer(), min_length=1, max_length=50))
class TestCasesField(serializers.JSONField):
    pass


class StrictPositiveInteger(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail("invalid")
        return super().to_internal_value(data)


class TestSuiteSerializer(serializers.ModelSerializer):
    cases = TestCasesField(read_only=True)
    revision = serializers.IntegerField(source="number", read_only=True)

    class Meta:
        model = models.ActionTestSuite
        fields = ["id", "version", "revision", "digest", "cases", "created_at"]
        read_only_fields = fields


class TestsRequest(serializers.Serializer):
    version = StrictPositiveInteger(min_value=1)
    cases = TestCasesField()

    def validate(self, attrs):
        bounded_json(self.initial_data)
        return attrs


class RunTestsRequest(serializers.Serializer):
    version = StrictPositiveInteger(min_value=1)
    suite_revision = StrictPositiveInteger(min_value=1)
    idempotency_key = serializers.CharField(max_length=200)


class ValidateCodeRequest(serializers.Serializer):
    project = serializers.UUIDField()
    source = serializers.CharField(trim_whitespace=False)
    input_schema = serializers.JSONField(default=dict)
    output_schema = serializers.JSONField(default=dict)
    idempotency_key = serializers.CharField(max_length=200)

    def validate(self, attrs):
        bounded_json(self.initial_data)
        attrs["input_schema"] = validate_schema(attrs["input_schema"])
        attrs["output_schema"] = validate_schema(attrs["output_schema"])
        return attrs


class SaveActionRequest(VersionSerializer):
    agent = serializers.UUIDField(required=False)
    project = serializers.UUIDField(required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = attrs.pop("project", None)
        agent = attrs.get("agent")
        if project is not None and agent is not None and project != agent:
            raise serializers.ValidationError("Project and legacy agent must match.")
        if project is None and agent is None:
            raise serializers.ValidationError({"project": "Select a project."})
        attrs["agent"] = project or agent
        return attrs

    action = serializers.UUIDField(required=False)
    name = serializers.CharField(max_length=100)

    class Meta(VersionSerializer.Meta):
        fields = VersionSerializer.Meta.fields + ["agent", "project", "action", "name"]


class PromoteRequest(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    action = serializers.UUIDField(required=False)
    input_schema = serializers.JSONField()
    output_schema = serializers.JSONField()

    def validate(self, attrs):
        bounded_json(self.initial_data)
        attrs["input_schema"] = validate_schema(attrs["input_schema"])
        attrs["output_schema"] = validate_schema(attrs["output_schema"])
        return attrs


class PluginSerializer(WorkspaceSerializer):
    tools = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()

    @extend_schema_field(serializers.ListField(child=serializers.JSONField(), allow_null=True))
    def get_tools(self, obj):
        return obj.release_metadata.get("tools") if obj.distribution == "external" else None

    def get_display_name(self, obj) -> str:
        return obj.release_metadata.get("display_name") or obj.slug

    slug = serializers.RegexField(r"^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$", max_length=50)
    source = serializers.CharField(max_length=200_000, required=False, allow_blank=True)
    distribution = serializers.ChoiceField(choices=["inline", "external"], required=False)
    refresh_bundle = serializers.BooleanField(write_only=True, required=False)

    class Meta:
        model = models.Plugin
        fields = [
            "id",
            "agent",
            "package_url",
            "tools",
            "display_name",
            "slug",
            "version",
            "description",
            "source",
            "digest",
            "enabled",
            "credential",
            "distribution",
            "configuration",
            "refresh_bundle",
        ]
        read_only_fields = ["digest"]
        validators = []

    def validate(self, attrs):
        if not attrs.get("agent", getattr(self.instance, "agent", None)):
            raise serializers.ValidationError({"agent": "Choose the agent that owns this plugin."})
        refresh_bundle = attrs.pop("refresh_bundle", False)
        distribution = attrs.get("distribution", getattr(self.instance, "distribution", "inline"))
        if self.instance and distribution != self.instance.distribution:
            raise serializers.ValidationError("Remove the plugin before changing its distribution.")
        if distribution == "external":
            slug = attrs.get("slug", getattr(self.instance, "slug", ""))
            version = attrs.get("version", getattr(self.instance, "version", None))
            pinned = self.instance and self.instance.version == version and not refresh_bundle
            release = (
                self.instance.release_metadata
                if pinned and self.instance.release_metadata
                else catalog_release(slug, version)
            )
            if attrs.get("source"):
                raise serializers.ValidationError(
                    "External plugin source is managed by the release."
                )
            credential = attrs.get("credential", getattr(self.instance, "credential", None))
            provider = release["auth"].get("provider")
            if credential and credential.provider != provider:
                raise serializers.ValidationError(
                    {"credential": f"Choose a {provider} credential."}
                )
            configuration = attrs.get("configuration", getattr(self.instance, "configuration", {}))
            if not isinstance(configuration, dict):
                raise serializers.ValidationError({"configuration": "Use a JSON object."})
            errors = list(
                Draft202012Validator(release["configuration_schema"]).iter_errors(configuration)
            )
            if errors:
                raise serializers.ValidationError({"configuration": errors[0].message})
            content_digest = release["digest"]
            if self.instance and self.instance.version == release["version"] and not refresh_bundle:
                content_digest = self.instance.digest
            attrs.update(
                source="",
                digest=content_digest,
                description=release["description"],
                package_url=release["package_url"],
                release_metadata=release,
            )
        elif not self.instance and not attrs.get("source"):
            raise serializers.ValidationError({"source": "Inline plugins require source."})
        if self.instance and "agent" in attrs and attrs["agent"].pk != self.instance.agent_id:
            raise serializers.ValidationError(
                {"agent": "Reinstall plugins to move them to another agent."}
            )
        query = models.Plugin.objects.filter(
            agent=attrs.get("agent", getattr(self.instance, "agent", None)),
            slug=attrs.get("slug", getattr(self.instance, "slug", "")),
        )
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError(
                "Plugin already installed; update its version explicitly."
            )
        if (
            self.instance
            and "source" in attrs
            and attrs["source"] != self.instance.source
            and attrs.get("version", self.instance.version) == self.instance.version
        ):
            raise serializers.ValidationError("Changed source requires a new version.")
        return attrs

    def create(self, validated_data):
        if validated_data.get("distribution", "inline") == "inline":
            validated_data["digest"] = source_digest(validated_data["source"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if instance.distribution == "inline" and "source" in validated_data:
            validated_data["digest"] = source_digest(validated_data["source"])
        return super().update(instance, validated_data)


class ArtifactSerializer(WorkspaceSerializer):
    content = serializers.CharField(max_length=1_000_000)

    class Meta:
        model = models.Artifact
        fields = ["id", "run", "name", "content", "media_type"]


class ScheduleSerializer(WorkspaceSerializer):
    class Meta:
        model = models.Schedule
        fields = ["id", "action", "cron", "inputs", "enabled", "next_run_at"]
        read_only_fields = ["next_run_at"]

    def validate_cron(self, value):
        if len(value.split()) != 5 or not croniter.is_valid(value):
            raise serializers.ValidationError("Use a valid five-field UTC cron expression.")
        return value

    @staticmethod
    def next_occurrence(cron):
        return datetime.fromtimestamp(croniter(cron, timezone.now()).get_next(float), UTC)

    def create(self, validated_data):
        validated_data["next_run_at"] = self.next_occurrence(validated_data["cron"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Resuming skips missed occurrences instead of immediately dispatching stale work.
        cron = validated_data.get("cron", instance.cron)
        is_resuming = validated_data.get("enabled", instance.enabled) and not instance.enabled
        if cron != instance.cron or is_resuming:
            validated_data["next_run_at"] = self.next_occurrence(cron)
        return super().update(instance, validated_data)


class PluginAuthSerializer(serializers.Serializer):
    type = serializers.CharField(required=False)
    provider = serializers.CharField(required=False)
    label = serializers.CharField(required=False)
    hint = serializers.CharField(required=False)


class CatalogEntrySerializer(serializers.Serializer):
    slug = serializers.CharField()
    version = serializers.CharField()
    digest = serializers.CharField()
    distribution = serializers.CharField()
    package_url = serializers.CharField(allow_blank=True)
    contract_version = serializers.IntegerField()
    display_name = serializers.CharField()
    description = serializers.CharField()
    category = serializers.CharField()
    auth = PluginAuthSerializer()
    marketplace = serializers.JSONField()
    documentation = serializers.CharField()
    configuration_schema = serializers.JSONField()
    tools = serializers.ListField(child=serializers.JSONField())


class WebhookDeliverySerializer(serializers.ModelSerializer):
    run_status = serializers.CharField(source="run.status", read_only=True, allow_null=True)

    class Meta:
        model = models.WebhookDelivery
        fields = ["id", "delivery_id", "received_at", "outcome", "run", "run_status"]


class WebhookSerializer(WorkspaceSerializer):
    action = serializers.PrimaryKeyRelatedField(
        queryset=models.Action.objects.all(), write_only=True
    )
    action_id = serializers.UUIDField(source="action_version.action_id", read_only=True)
    action_name = serializers.CharField(source="action_version.action.name", read_only=True)
    version = serializers.IntegerField(source="action_version.number", read_only=True)
    endpoint = serializers.SerializerMethodField()
    deliveries = serializers.SerializerMethodField()

    def get_endpoint(self, obj) -> str:
        return f"/api/v1/webhook-ingress/{obj.pk}/"

    @extend_schema_field(WebhookDeliverySerializer(many=True))
    def get_deliveries(self, obj):
        return WebhookDeliverySerializer(
            obj.deliveries.select_related("run").order_by("-received_at")[:20], many=True
        ).data

    def validate_action(self, value):
        if self.instance:
            raise serializers.ValidationError("Register a new webhook to change its action.")
        if not value.enabled or not value.versions.exists():
            raise serializers.ValidationError("Choose an enabled action with a saved version.")
        return value

    class Meta:
        model = models.Webhook
        fields = [
            "id",
            "name",
            "action",
            "action_id",
            "action_name",
            "version",
            "enabled",
            "endpoint",
            "rotated_at",
            "last_received_at",
            "last_accepted_at",
            "last_rejection",
            "last_rejected_at",
            "deliveries",
        ]
        read_only_fields = [
            "rotated_at",
            "last_received_at",
            "last_accepted_at",
            "last_rejection",
            "last_rejected_at",
        ]


class WebhookSecretSerializer(serializers.Serializer):
    webhook = WebhookSerializer()
    secret = serializers.CharField()


class WebhookReceiptSerializer(serializers.Serializer):
    run = serializers.UUIDField(allow_null=True, required=False)
    outcome = serializers.CharField(required=False)
    duplicate = serializers.BooleanField(required=False)
    detail = serializers.CharField(required=False)


class WebhookPayloadSerializer(serializers.Serializer):
    inputs = serializers.DictField()
