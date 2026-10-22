from rest_framework import serializers

from .forms import InstallationSetupForm


class InstallationSetupStatusSerializer(serializers.Serializer):
    setup_required = serializers.BooleanField()
    hostname = serializers.CharField()


class InstallationSetupRequestSerializer(serializers.Serializer):
    domain = serializers.CharField(max_length=253)
    workspace_name = serializers.CharField(max_length=100)
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password1 = serializers.CharField(write_only=True, trim_whitespace=False)
    password2 = serializers.CharField(write_only=True, trim_whitespace=False)
    project_name = serializers.CharField(max_length=100, required=False, allow_blank=True)

    agent_name = serializers.CharField(
        max_length=100, required=False, allow_blank=True, write_only=True
    )

    def validate(self, attrs):
        if not attrs.get("project_name"):
            attrs["project_name"] = attrs.get("agent_name", "")
        self.form = InstallationSetupForm(attrs, hostname=self.context["hostname"])
        if not self.form.is_valid():
            raise serializers.ValidationError(
                {
                    "non_field_errors" if field == "__all__" else field: list(errors)
                    for field, errors in self.form.errors.items()
                }
            )
        return attrs


class InstallationSetupCompleteSerializer(serializers.Serializer):
    setup_required = serializers.BooleanField()
    login_url = serializers.CharField()


class InstallationSetupErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
