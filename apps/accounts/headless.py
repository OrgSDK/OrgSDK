"""Allauth browser endpoints with local account recovery and no email delivery."""

from allauth.account.internal.flows import manage_email
from allauth.account.models import EmailAddress
from allauth.headless.account.inputs import AddEmailInput
from allauth.headless.account.views import ManageEmailView
from allauth.headless.internal.restkit.response import ErrorResponse
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction


class LocalEmailInput(AddEmailInput):
    def clean_email(self):
        email = super().clean_email()
        return manage_email.email_already_exists(email, user=self.user, always_raise=True)[0]

    @transaction.atomic
    def save(self, request):
        # Serialize identity changes and retain honest, unverified ownership status.
        get_user_model().objects.get(pk=self.user.pk)
        manage_email.email_already_exists(
            self.cleaned_data["email"], user=self.user, always_raise=True
        )
        previous = EmailAddress.objects.filter(user=self.user, primary=True).first()
        address = EmailAddress.objects.create(
            user=self.user, email=self.cleaned_data["email"], verified=False
        )
        address.set_as_primary()
        manage_email.emit_email_changed(request, previous, address)
        # This product has one sign-in address, rather than hidden login aliases.
        for old_address in EmailAddress.objects.filter(user=self.user).exclude(pk=address.pk):
            manage_email.delete_email(request, old_address)
        return address


class LocalEmailView(ManageEmailView):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    # Allauth retains authentication, rate limiting, reauthentication and signals.
    input_class = {**ManageEmailView.input_class, "POST": LocalEmailInput}

    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except IntegrityError:
            # A concurrent account may have claimed the address after validation.
            # save() has left its atomic block, so classification uses a valid connection.
            self.user.refresh_from_db(fields=["email"])
            try:
                manage_email.email_already_exists(
                    self.input.cleaned_data["email"], user=self.user, always_raise=True
                )
            except ValidationError as error:
                return ErrorResponse(request, exception=error)
            raise
        except ValidationError as error:
            return ErrorResponse(request, exception=error)
