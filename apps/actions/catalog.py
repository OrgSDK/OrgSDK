"""Explicit external marketplace metadata; never fetch packages inside Django."""

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from jsonschema import Draft202012Validator, SchemaError
from rest_framework.exceptions import ValidationError

STRING_FIELDS = (
    "slug",
    "version",
    "digest",
    "package_url",
    "display_name",
    "description",
    "category",
    "documentation",
)


def validate_release(entry, position):
    prefix = f"Plugin catalog entry {position}"
    if not isinstance(entry, dict):
        raise ValidationError(f"{prefix} must be an object.")
    for field in STRING_FIELDS:
        if not isinstance(entry.get(field), str):
            raise ValidationError(f"{prefix}: {field} must be a string.")
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*", entry["slug"]):
        raise ValidationError(f"{prefix}: slug must use lowercase words separated by hyphens.")
    if not entry["version"] or len(entry["version"]) > 100:
        raise ValidationError(f"{prefix}: version must contain 1 to 100 characters.")
    if entry.get("distribution") != "external" or entry.get("contract_version") != 1:
        raise ValidationError(f"{prefix}: use distribution external and contract_version 1.")
    try:
        url = urlsplit(entry["package_url"])
        valid_url = (
            url.scheme == "https"
            and bool(url.hostname)
            and not url.username
            and not url.password
            and not url.fragment
        )
        valid_url = not entry["package_url"] or (
            valid_url and (url.port is None or 0 < url.port < 65536)
        )
    except ValueError:
        valid_url = False
    if not valid_url:
        raise ValidationError(
            f"{prefix}: package_url must be blank for a preinstalled local bundle "
            "or an HTTPS URL without credentials or fragments."
        )
    if not re.fullmatch(r"[a-f0-9]{64}", entry["digest"]):
        raise ValidationError(f"{prefix}: digest must be a lowercase SHA256 checksum.")
    for field in ("auth", "marketplace", "configuration_schema"):
        if not isinstance(entry.get(field), dict):
            raise ValidationError(f"{prefix}: {field} must be an object.")
    auth = entry["auth"]
    for key in ("type", "provider", "label", "hint"):
        if key in auth and auth[key] is not None and not isinstance(auth[key], str):
            raise ValidationError(f"{prefix}: auth.{key} must be a string.")
    if "scopes" in auth and (
        not isinstance(auth["scopes"], list)
        or not all(isinstance(scope, str) for scope in auth["scopes"])
    ):
        raise ValidationError(f"{prefix}: auth.scopes must be a list of strings.")
    if not isinstance(entry.get("tools"), list) or not all(
        isinstance(tool, dict) for tool in entry["tools"]
    ):
        raise ValidationError(f"{prefix}: tools must be a list of objects.")
    try:
        Draft202012Validator.check_schema(entry["configuration_schema"])
    except SchemaError as error:
        raise ValidationError(
            f"{prefix}: configuration_schema is not valid JSON Schema."
        ) from error


def catalog_entries():
    path = getattr(settings, "PLUGIN_CATALOG_PATH", "")
    if not path:
        return []
    try:
        entries = json.loads(Path(path).read_text())
    except (OSError, ValueError, TypeError) as error:
        raise ValidationError(
            "Cannot read the configured plugin catalog. "
            "Check PLUGIN_CATALOG_PATH and its JSON contents."
        ) from error
    if not isinstance(entries, list):
        raise ValidationError("The configured plugin catalog must contain a JSON list.")
    releases = set()
    for position, entry in enumerate(entries, start=1):
        validate_release(entry, position)
        key = (entry["slug"], entry["version"])
        if key in releases:
            raise ValidationError(
                f"Plugin catalog contains duplicate release {key[0]} version {key[1]}."
            )
        releases.add(key)
    return entries


def catalog_release(slug, version=None):
    for entry in catalog_entries():
        if entry["slug"] == slug and (version is None or entry["version"] == version):
            return entry
    raise ValidationError("This external plugin version is not in the configured marketplace.")
