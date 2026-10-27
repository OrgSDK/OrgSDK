"""Random bearer secrets and one-way storage shared by API access and execution."""

import hashlib
import secrets


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token():
    return secrets.token_urlsafe(48)
