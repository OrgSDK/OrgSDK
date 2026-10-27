from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name"]
        # Email changes must go through the account identity API.
        read_only_fields = ["id", "username", "email"]


class SessionSerializer(serializers.Serializer):
    is_authenticated = serializers.BooleanField()
    user = UserSerializer(allow_null=True)
