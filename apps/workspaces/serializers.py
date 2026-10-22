from rest_framework import serializers

from .models import Invitation, Membership, Workspace


class WorkspaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Workspace
        fields = ["id", "name"]
        read_only_fields = ["id"]


class WorkspaceSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    role = serializers.ChoiceField(choices=Membership.Role.choices)
    is_active = serializers.BooleanField()


class MemberSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user_id", "email", "username", "role"]
        read_only_fields = fields


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=[("admin", "Admin"), ("member", "Member")])


class TransferSerializer(serializers.Serializer):
    membership_id = serializers.IntegerField()


class InvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invitation
        fields = ["id", "email", "role", "expires_at", "accepted_at", "revoked_at"]
        read_only_fields = ["id", "expires_at", "accepted_at", "revoked_at"]
        validators = []

    def validate_email(self, value):
        return value.strip().lower()


class WorkspaceDetailSerializer(serializers.Serializer):
    workspace = WorkspaceSerializer()
    role = serializers.ChoiceField(choices=Membership.Role.choices)
    members = MemberSerializer(many=True)
    invitations = InvitationSerializer(many=True)
