from rest_framework import serializers


class Registration(serializers.Serializer):
    protocol_version = serializers.IntegerField(min_value=1, max_value=3)
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(
            choices=[
                ("action", "Action"),
                ("chat", "Chat"),
                ("code", "Code"),
                ("validate", "Validate"),
                ("test", "Test"),
            ]
        )
    )

    def validate(self, attrs):
        if attrs["protocol_version"] == 1 and "code" in attrs["capabilities"]:
            raise serializers.ValidationError("Code requires executor protocol 2.")
        if attrs["protocol_version"] < 3 and {"validate", "test"} & set(attrs["capabilities"]):
            raise serializers.ValidationError("Validation and tests require executor protocol 3.")
        return attrs


class Registered(serializers.Serializer):
    agent_id = serializers.UUIDField(allow_null=True)
    plugins = serializers.ListField(child=serializers.JSONField())
    id = serializers.UUIDField()
    pool = serializers.CharField()
    protocol_version = serializers.IntegerField()


class Claim(serializers.Serializer):
    run_id = serializers.UUIDField()
    protocol_version = serializers.IntegerField()
    capability = serializers.CharField()
    workspace_id = serializers.IntegerField()
    actor_id = serializers.IntegerField()
    operation = serializers.CharField()
    inputs = serializers.JSONField()
    snapshot = serializers.JSONField()
    deadline = serializers.DateTimeField()
    lease_seconds = serializers.IntegerField()


class Heartbeat(serializers.Serializer):
    cancel_requested = serializers.BooleanField()
    status = serializers.CharField()


class Event(serializers.Serializer):
    sequence = serializers.IntegerField(min_value=1)
    kind = serializers.CharField(max_length=50)
    data = serializers.JSONField(default=dict)

    def validate_data(self, value):
        if len(str(value)) > 200_000:
            raise serializers.ValidationError("Event exceeds 200KB.")
        return value


class Completion(serializers.Serializer):
    status = serializers.ChoiceField(choices=["succeeded", "failed", "cancelled"])
    output = serializers.JSONField(default=dict)
    error = serializers.CharField(max_length=10_000, allow_blank=True, default="")

    def validate_output(self, value):
        if len(str(value)) > 1_000_000:
            raise serializers.ValidationError("Output exceeds 1MB; use artifacts.")
        return value


class Secret(serializers.Serializer):
    secret = serializers.JSONField()


class LocalRegistration(serializers.Serializer):
    agent_id = serializers.UUIDField()
    executor_id = serializers.UUIDField()
    token = serializers.CharField()


class Bootstrap(serializers.Serializer):
    registrations = LocalRegistration(many=True)


class Delegation(serializers.Serializer):
    agent_id = serializers.UUIDField()
    message = serializers.CharField(max_length=200_000)
    idempotency_key = serializers.CharField(max_length=100)


class DelegationResult(serializers.Serializer):
    run_id = serializers.UUIDField()
    status = serializers.CharField()
    output = serializers.JSONField()
    error = serializers.CharField()
