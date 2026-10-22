from rest_framework import serializers

from .models import AuditEvent


class AuditFilterSerializer(serializers.Serializer):
    kind = serializers.CharField(max_length=100, required=False)
    actor = serializers.IntegerField(min_value=1, max_value=9223372036854775807, required=False)
    object_id = serializers.CharField(max_length=100, required=False)
    since = serializers.DateTimeField(
        required=False, help_text="Inclusive lower timestamp (ISO 8601)."
    )
    before = serializers.DateTimeField(
        required=False, help_text="Exclusive upper timestamp (ISO 8601)."
    )
    page = serializers.IntegerField(min_value=1, max_value=2147483647, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)

    def validate(self, attrs):
        if "since" in attrs and "before" in attrs and attrs["since"] >= attrs["before"]:
            raise serializers.ValidationError(
                "The end timestamp must be after the start timestamp."
            )
        return attrs


class AuditEventSerializer(serializers.ModelSerializer):
    actor_id = serializers.SerializerMethodField()
    actor_label = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = ["id", "actor_id", "actor_label", "kind", "object_id", "created_at"]
        read_only_fields = fields

    def get_actor_id(self, obj) -> int | None:
        return obj.actor_id if obj.actor_id in self.context["member_ids"] else None

    def get_actor_label(self, obj) -> str:
        if obj.actor_id is None:
            return "System or deleted account"
        if obj.actor_id not in self.context["member_ids"]:
            return "Former workspace member"
        return obj.actor.get_full_name().strip() or obj.actor.username
