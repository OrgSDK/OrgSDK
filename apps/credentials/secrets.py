import json

from cryptography.fernet import Fernet
from django.conf import settings
from rest_framework.exceptions import ValidationError


def cipher():
    if not settings.CREDENTIAL_ENCRYPTION_KEY:
        raise ValidationError("Configure CREDENTIAL_ENCRYPTION_KEY before saving credentials.")
    return Fernet(settings.CREDENTIAL_ENCRYPTION_KEY.encode())


def encrypt(value):
    return cipher().encrypt(json.dumps(value).encode()).decode()


def decrypt(value):
    return json.loads(cipher().decrypt(value.encode()))
