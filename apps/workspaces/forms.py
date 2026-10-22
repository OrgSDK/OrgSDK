import ipaddress
import re

from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm


class InstallationSetupForm(UserCreationForm):
    domain = forms.CharField(
        max_length=253,
        help_text="The hostname for this workspace, without a port or https://.",
    )
    workspace_name = forms.CharField(max_length=100, label="Workspace name")
    email = forms.EmailField(label="Owner email")

    project_name = forms.CharField(max_length=100, initial="My project", required=False)

    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ("domain", "workspace_name", "username", "email", "password1", "password2")

    def __init__(self, *args, hostname, **kwargs):
        super().__init__(*args, **kwargs)
        self.hostname = hostname
        self.fields["domain"].initial = hostname

    def clean_domain(self):
        domain = self.cleaned_data["domain"].lower().rstrip(".")
        is_ipv6 = False
        if domain.startswith("[") and domain.endswith("]"):
            try:
                ipaddress.IPv6Address(domain[1:-1])
                is_ipv6 = True
            except ValueError:
                pass
        if not is_ipv6 and not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*",
            domain,
        ):
            raise forms.ValidationError("Enter a hostname without a scheme, port or path.")
        if domain != self.hostname:
            raise forms.ValidationError("Open this site on that domain before completing setup.")
        return domain

    def clean_email(self):
        email = self.cleaned_data["email"].lower()
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("An account with this email already exists.")
        return email
