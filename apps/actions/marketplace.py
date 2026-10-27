"""Read public discovery metadata without downloading executable plugin packages."""

import hashlib
import json
from urllib.parse import urlsplit

import httpx
from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import APIException, ValidationError

MAX_CATALOG_BYTES = 2 * 1024 * 1024


class MarketplaceUnavailable(APIException):
    status_code = 503
    default_detail = "The plugin marketplace is unavailable. Try again later."
    default_code = "marketplace_unavailable"


def remote_json(url):
    if not url:
        return None
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ValueError("Use an HTTPS marketplace URL without credentials or fragments.")
    except ValueError as error:
        raise ValidationError("Invalid plugin marketplace URL configuration.") from error
    key = "plugin-marketplace:" + hashlib.sha256(url.encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        with httpx.stream("GET", url, timeout=5, follow_redirects=False) as response:
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > MAX_CATALOG_BYTES:
                    raise ValueError("Plugin marketplace response is too large.")
        return json.loads(content)
    except (httpx.HTTPError, ValueError) as error:
        raise MarketplaceUnavailable() from error


def cache_remote_json(url, data):
    key = "plugin-marketplace:" + hashlib.sha256(url.encode()).hexdigest()
    cache.set(key, data, timeout=300)


def marketplace_entries():
    url = settings.PLUGIN_MARKETPLACE_URL
    if not url:
        return []
    data = remote_json(url)
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise MarketplaceUnavailable("Unsupported plugin marketplace schema.")
    from .serializers import MarketplaceListingSerializer

    serializer = MarketplaceListingSerializer(data=data.get("plugins"), many=True)
    if not serializer.is_valid():
        raise MarketplaceUnavailable("The plugin marketplace returned invalid listings.")
    entries = serializer.validated_data
    slugs = [entry["slug"] for entry in entries]
    if len(slugs) != len(set(slugs)):
        raise MarketplaceUnavailable("The plugin marketplace returned duplicate listings.")
    cache_remote_json(url, data)
    return entries
