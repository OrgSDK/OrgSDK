import json
from contextlib import contextmanager

import httpx
import pytest
from rest_framework.exceptions import ValidationError

from apps.actions.catalog import catalog_entries
from apps.actions.marketplace import MarketplaceUnavailable, marketplace_entries, remote_json


@pytest.fixture
def public_listing():
    return {
        "slug": "github",
        "display_name": "GitHub",
        "description": "Issues and pull requests",
        "category": "Developer",
        "tags": ["git"],
        "use_cases": ["Review pull requests"],
        "permissions": "API token",
        "auth_type": "token",
        "source_version": "1.0.2",
        "source_url": "",
        "url": "https://orgsdk.ai/plugins/github",
        "release_status": "unreleased",
        "icon_url": "https://orgsdk.ai/plugins/icons/github.svg",
        "tool_count": 37,
    }


@pytest.fixture
def serve_metadata(monkeypatch):
    calls = []

    def serve(data, status=200):
        @contextmanager
        def stream(method, url, **kwargs):
            calls.append((method, url, kwargs))
            yield httpx.Response(status, json=data, request=httpx.Request(method, url))

        monkeypatch.setattr(httpx, "stream", stream)
        return calls

    return serve


def test_remote_discovery_is_validated_and_cached(settings, serve_metadata, public_listing):
    settings.PLUGIN_MARKETPLACE_URL = "https://orgsdk.ai/plugins/catalog.json"
    calls = serve_metadata({"schema_version": 1, "plugins": [public_listing]})
    assert marketplace_entries() == [public_listing]
    assert marketplace_entries() == [public_listing]
    assert len(calls) == 1
    assert calls[0][1] == settings.PLUGIN_MARKETPLACE_URL
    assert calls[0][2] == {"timeout": 5, "follow_redirects": False}


@pytest.mark.parametrize(
    "change",
    [
        {"url": "javascript:alert(1)"},
        {"url": "http://orgsdk.ai/plugins/github"},
        {"slug": "../bad"},
        {"release_status": "install-now"},
        {"source_url": "http://example.test"},
        {"icon_url": "javascript:alert(1)"},
        {"icon_url": "http://example.test/icon.svg"},
        {"tool_count": -1},
    ],
)
def test_invalid_remote_listings_are_not_cached(settings, serve_metadata, public_listing, change):
    settings.PLUGIN_MARKETPLACE_URL = "https://orgsdk.ai/plugins/catalog.json"
    public_listing.update(change)
    calls = serve_metadata({"schema_version": 1, "plugins": [public_listing]})
    for _ in range(2):
        with pytest.raises(MarketplaceUnavailable):
            marketplace_entries()
    assert len(calls) == 2


def test_discovery_without_optional_artwork_remains_compatible(
    settings, serve_metadata, public_listing
):
    settings.PLUGIN_MARKETPLACE_URL = "https://orgsdk.ai/plugins/catalog.json"
    public_listing.pop("icon_url")
    public_listing.pop("tool_count")
    serve_metadata({"schema_version": 1, "plugins": [public_listing]})
    assert marketplace_entries() == [{**public_listing, "icon_url": "", "tool_count": 0}]


@pytest.mark.parametrize("status", [301, 404, 500])
def test_remote_failure_is_explicit(serve_metadata, status):
    serve_metadata({}, status=status)
    with pytest.raises(MarketplaceUnavailable):
        remote_json("https://orgsdk.ai/plugins/releases.json")


def test_timeout_is_explicit(monkeypatch):
    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("timeout")

    monkeypatch.setattr(httpx, "stream", timeout)
    with pytest.raises(MarketplaceUnavailable):
        remote_json("https://orgsdk.ai/plugins/releases.json")


@pytest.mark.parametrize(
    "url",
    [
        "http://orgsdk.ai/catalog.json",
        "https://user:secret@example.test/feed",
        "https://orgsdk.ai/feed#fragment",
    ],
)
def test_insecure_catalog_configuration_never_fetches(url, monkeypatch):
    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: pytest.fail("Unexpected request"))
    with pytest.raises(ValidationError):
        remote_json(url)


def test_response_size_is_bounded(serve_metadata):
    serve_metadata({"payload": "x" * (2 * 1024 * 1024)})
    with pytest.raises(MarketplaceUnavailable):
        remote_json("https://orgsdk.ai/plugins/catalog.json")


@pytest.mark.parametrize("data", [None, [], {"schema_version": 2, "plugins": []}])
def test_invalid_schema_is_rejected(settings, serve_metadata, data):
    settings.PLUGIN_MARKETPLACE_URL = "https://orgsdk.ai/plugins/catalog.json"
    serve_metadata(data)
    with pytest.raises(MarketplaceUnavailable):
        marketplace_entries()


def test_duplicate_listings_are_rejected(settings, serve_metadata, public_listing):
    settings.PLUGIN_MARKETPLACE_URL = "https://orgsdk.ai/plugins/catalog.json"
    serve_metadata({"schema_version": 1, "plugins": [public_listing, public_listing]})
    with pytest.raises(MarketplaceUnavailable):
        marketplace_entries()


def test_release_url_uses_existing_contract(settings, serve_metadata):
    settings.PLUGIN_CATALOG_PATH = ""
    settings.PLUGIN_CATALOG_URL = "https://orgsdk.ai/plugins/releases.json"
    release = {
        "slug": "github",
        "version": "1.0.2",
        "digest": "a" * 64,
        "package_url": "https://orgsdk.ai/plugins/packages/github/release.mjs",
        "distribution": "external",
        "contract_version": 1,
        "display_name": "GitHub",
        "description": "GitHub tools",
        "category": "Developer",
        "documentation": "Reference",
        "auth": {},
        "marketplace": {},
        "configuration_schema": {"type": "object"},
        "tools": [],
    }
    calls = serve_metadata([release])
    assert catalog_entries() == [release]
    assert catalog_entries() == [release]
    assert len(calls) == 1
    assert calls[0][1] == settings.PLUGIN_CATALOG_URL


def test_local_catalog_takes_precedence(settings, tmp_path, monkeypatch):
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps([]))
    settings.PLUGIN_CATALOG_PATH = str(path)
    settings.PLUGIN_CATALOG_URL = "https://orgsdk.ai/plugins/releases.json"
    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: pytest.fail("Unexpected request"))
    assert catalog_entries() == []


def test_offline_marketplace(settings):
    settings.PLUGIN_CATALOG_PATH = ""
    settings.PLUGIN_CATALOG_URL = ""
    settings.PLUGIN_MARKETPLACE_URL = ""
    assert marketplace_entries() == []
    assert catalog_entries() == []
