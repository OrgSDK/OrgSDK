"""Workspace-owned OAuth setup and refresh. Executors receive access tokens only."""

import base64
import hashlib
import time
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.actions.catalog import catalog_release
from apps.actions.models import Plugin
from apps.audit.services import audit
from apps.core.tokens import digest, issue_token
from apps.workspaces.services import lock_membership, require_manager

from .models import Credential, OAuthAttempt
from .secrets import decrypt, encrypt

PROVIDERS = {
    "google-oauth": (
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
    ),
    "twitter-oauth": (
        "https://twitter.com/i/oauth2/authorize",
        "https://api.twitter.com/2/oauth2/token",
    ),
    "linkedin-oauth": (
        "https://www.linkedin.com/oauth/v2/authorization",
        "https://www.linkedin.com/oauth/v2/accessToken",
    ),
    "facebook-oauth": (
        "https://www.facebook.com/v21.0/dialog/oauth",
        "https://graph.facebook.com/v21.0/oauth/access_token",
    ),
}


def exchange(provider, payload, data):
    if not all(
        isinstance(payload.get(key), str) and payload[key]
        for key in ["secret_clientId", "secret_clientSecret"]
    ):
        raise ValidationError("Reconnect this credential with a valid OAuth client ID and secret.")
    data = dict(data)
    data["client_id"] = payload["secret_clientId"]
    auth = None
    if provider == "twitter-oauth":
        auth = (payload["secret_clientId"], payload["secret_clientSecret"])
    else:
        data["client_secret"] = payload["secret_clientSecret"]
    try:
        response = httpx.post(PROVIDERS[provider][1], data=data, auth=auth, timeout=20)
        response.raise_for_status()
        tokens = response.json()
        if not isinstance(tokens.get("access_token"), str) or not tokens["access_token"]:
            raise ValueError("Missing access token")
        return tokens
    except (httpx.HTTPError, ValueError, KeyError) as error:
        # Provider responses can contain credentials; never relay them to clients or run logs.
        raise ValidationError(
            "OAuth token exchange failed. Check the app settings and reconnect."
        ) from error


def apply_tokens(payload, tokens):
    payload["secret_accessToken"] = tokens["access_token"]
    payload["expires_at"] = time.time() + float(tokens.get("expires_in", 3600))
    if tokens.get("refresh_token"):
        payload["secret_refreshToken"] = tokens["refresh_token"]
    if tokens.get("scope"):
        payload["scopes"] = tokens["scope"].split()
    return payload


@transaction.atomic
def begin_connection(request, data):
    membership = lock_membership(request)
    require_manager(membership)
    plugin = Plugin.objects.filter(
        pk=data["plugin"], workspace=membership.workspace, distribution="external"
    ).first()
    if plugin is None:
        raise ValidationError("Choose an installed external plugin in this workspace.")
    release = plugin.release_metadata or catalog_release(plugin.slug, plugin.version)
    auth = release["auth"]
    provider = auth.get("provider")
    if auth.get("type") != "oauth2" or provider not in PROVIDERS:
        raise ValidationError("This plugin does not use OAuth.")
    if not request.session.session_key:
        request.session.save()
    state, verifier = issue_token(), issue_token()
    callback = request.build_absolute_uri("/api/v1/credentials/oauth-callback/")
    payload = {
        "secret_clientId": data["client_id"],
        "secret_clientSecret": data["client_secret"],
        "source": "byo",
        "provider": provider,
        "name": data["name"],
        "redirect_uri": callback,
        "verifier": verifier,
        "scopes": auth.get("scopes", []),
    }
    OAuthAttempt.objects.filter(expires_at__lt=timezone.now()).delete()
    OAuthAttempt.objects.create(
        workspace=membership.workspace,
        user=request.user,
        plugin=plugin,
        state_digest=digest(state),
        session_digest=digest(request.session.session_key),
        encrypted_payload=encrypt(payload),
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    query = {
        "client_id": data["client_id"],
        "redirect_uri": callback,
        "response_type": "code",
        "scope": " ".join(payload["scopes"]),
        "state": state,
    }
    if provider in {"google-oauth", "twitter-oauth"}:
        query.update(
            code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("="),
            code_challenge_method="S256",
        )
    if provider == "google-oauth":
        query.update(access_type="offline", prompt="consent")
    return PROVIDERS[provider][0] + "?" + urlencode(query)


@transaction.atomic
def finish_connection(request, state, code):
    membership = lock_membership(request)
    require_manager(membership)
    attempt = OAuthAttempt.objects.filter(
        state_digest=digest(state),
        user=request.user,
        workspace=membership.workspace,
        session_digest=digest(request.session.session_key or ""),
        expires_at__gt=timezone.now(),
    ).first()
    if attempt is None:
        raise ValidationError("This connection request has expired or belongs to another session.")
    payload = decrypt(attempt.encrypted_payload)
    provider = payload["provider"]
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": payload.pop("redirect_uri"),
    }
    if provider in {"google-oauth", "twitter-oauth"}:
        data["code_verifier"] = payload["verifier"]
    payload.pop("verifier")
    payload = apply_tokens(payload, exchange(provider, payload, data))
    credential = Credential.objects.create(
        workspace=membership.workspace,
        name=payload.pop("name"),
        provider=payload.pop("provider"),
        encrypted_secret=encrypt(payload),
    )
    Plugin.objects.filter(pk=attempt.plugin_id, workspace=membership.workspace).update(
        credential=credential
    )
    audit(membership.workspace, request.user, "credential.connected", credential)
    attempt.delete()
    return credential


@transaction.atomic
def execution_secret(credential):
    credential = Credential.objects.get(pk=credential.pk)
    payload = decrypt(credential.encrypted_secret)
    if credential.provider not in PROVIDERS:
        return payload
    if payload.get("source") == "first-party":
        raise ValidationError(
            "Reconnect using your own OAuth application; the old relay is retired."
        )
    expiry = payload.get("expires_at", 0)
    if not isinstance(expiry, (int, float)):
        raise ValidationError("Invalid credential expiry. Reconnect this credential.")
    if expiry <= time.time() + 60:
        if payload.get("secret_refreshToken"):
            payload = apply_tokens(
                payload,
                exchange(
                    credential.provider,
                    payload,
                    {
                        "grant_type": "refresh_token",
                        "refresh_token": payload["secret_refreshToken"],
                    },
                ),
            )
            credential.encrypted_secret = encrypt(payload)
            credential.save(update_fields=["encrypted_secret", "updated_at"])
        elif not payload.get("secret_accessToken") or payload.get("expires_at"):
            raise ValidationError("Reconnect this credential: its access token has expired.")
    return {"secret_accessToken": payload["secret_accessToken"], "source": "byo"}
