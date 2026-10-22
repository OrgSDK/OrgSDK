import os
import subprocess
import sys

import pytest


@pytest.fixture
def settings_env():
    return {
        **os.environ,
        "DJANGO_SECRET_KEY": "local-settings-test-key-" * 4,
        "DJANGO_ALLOWED_HOSTS": "localhost",
        "DATABASE_URL": "postgresql://test:test@127.0.0.1:5432/test",
    }


@pytest.mark.parametrize("profile", ["local", "deployment"])
@pytest.mark.parametrize("local_requirement", [None, "False", "True"])
def test_email_verification_is_disabled_for_every_profile(settings_env, profile, local_requirement):
    environment = dict(settings_env)
    environment.pop("LOCAL_REQUIRE_EMAIL_VERIFICATION", None)
    if local_requirement is not None:
        environment["LOCAL_REQUIRE_EMAIL_VERIFICATION"] = local_requirement
    script = f"""
import importlib
import environ
# Check deployment configuration independently of any developer .env file.
environ.Env.read_env = lambda *args, **kwargs: None
settings = importlib.import_module("config.settings.{profile}")
print(settings.ACCOUNT_EMAIL_VERIFICATION)
"""
    result = subprocess.run(
        [sys.executable, "-c", script], env=environment, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "none"


@pytest.mark.parametrize("profile", ["local", "deployment"])
def test_product_profiles_have_no_billing_or_rollout_services(settings_env, profile):
    script = f"""
import importlib
import environ
environ.Env.read_env = lambda *args, **kwargs: None
settings = importlib.import_module("config.settings.{profile}")
assert not {{"apps.billing", "apps.features", "waffle"}}.intersection(settings.INSTALLED_APPS)
assert "waffle.middleware.WaffleMiddleware" not in settings.MIDDLEWARE
assert not hasattr(settings, "CELERY_BEAT_SCHEDULE")
assert settings.CACHES["default"]["BACKEND"] == "apps.core.cache.SharedDatabaseCache"
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        env=settings_env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("profile", ["local", "deployment"])
@pytest.mark.parametrize("explicit_hosts", [None, "only.example.com"])
def test_local_host_alias_defaults_are_scoped_and_overridable(
    settings_env, profile, explicit_hosts
):
    import json

    environment = dict(settings_env)
    environment.pop("WORKSPACE_SINGLE_HOST_FALLBACK", None)
    if explicit_hosts is None:
        environment.pop("DJANGO_ALLOWED_HOSTS", None)
    else:
        environment["DJANGO_ALLOWED_HOSTS"] = explicit_hosts
    script = f"""
import importlib, json, environ
environ.Env.read_env = lambda *args, **kwargs: None
settings = importlib.import_module("config.settings.{profile}")
print(json.dumps([
    settings.ALLOWED_HOSTS, settings.WORKSPACE_SINGLE_HOST_FALLBACK,
    settings.WORKSPACE_DOMAIN_ROUTING, settings.CSRF_TRUSTED_ORIGINS,
]))
"""
    result = subprocess.run(
        [sys.executable, "-c", script], env=environment, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    hosts, fallback, routing, csrf = json.loads(result.stdout)
    assert hosts == ([explicit_hosts] if explicit_hosts else ["*"])
    assert fallback is True
    assert routing is True
    assert "*" not in csrf


@pytest.mark.parametrize("profile", ["local", "deployment"])
def test_local_hostname_fallback_can_be_disabled(settings_env, profile):
    environment = dict(settings_env, WORKSPACE_SINGLE_HOST_FALLBACK="False")
    script = f"""
import importlib, environ
environ.Env.read_env = lambda *args, **kwargs: None
settings = importlib.import_module("config.settings.{profile}")
print(settings.WORKSPACE_SINGLE_HOST_FALLBACK)
"""
    result = subprocess.run(
        [sys.executable, "-c", script], env=environment, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False"
