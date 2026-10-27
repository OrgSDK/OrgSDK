import base64
import stat
import subprocess
import sys
from pathlib import Path


def test_generated_local_environment_is_private_and_secret_output_is_avoided(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "init_deployment.py"
    result = subprocess.run(
        [sys.executable, "-S", str(script)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    environment_file = tmp_path / ".env.deployment"
    values = dict(line.split("=", 1) for line in environment_file.read_text().splitlines())
    assert values["DJANGO_SETTINGS_MODULE"] == "config.settings.deployment"
    assert values["BIND_ADDRESS"] == "0.0.0.0"
    assert values["DJANGO_ALLOWED_HOSTS"] == "*"
    assert values["HTTP_PORT"] == "8080"
    assert "DATABASE_URL" not in values and "POSTGRES_PASSWORD" not in values
    assert len(base64.urlsafe_b64decode(values["CREDENTIAL_ENCRYPTION_KEY"])) == 32
    assert stat.S_IMODE(environment_file.stat().st_mode) == 0o600
    for key in (
        "DJANGO_SECRET_KEY",
        "CREDENTIAL_ENCRYPTION_KEY",
        "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN",
    ):
        assert values[key] not in result.stdout + result.stderr
    original = environment_file.read_bytes()
    repeated = subprocess.run(
        [sys.executable, str(script)], cwd=tmp_path, capture_output=True, check=False
    )
    assert repeated.returncode != 0
    assert environment_file.read_bytes() == original
