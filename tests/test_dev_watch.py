"""Exercise worker reloads without touching the development stack."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

WATCHER = Path(__file__).resolve().parents[1] / "scripts" / "watch_python.py"


def wait_for_starts(path: Path, count: int) -> list[int]:
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        lines = path.read_text().splitlines() if path.exists() else []
        if len(lines) >= count:
            return [int(line) for line in lines]
        time.sleep(0.05)
    raise AssertionError(f"Worker did not start {count} times")


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_source_additions_and_deletions_restart_only_owned_worker(tmp_path):
    (tmp_path / "apps").mkdir()
    (tmp_path / "config").mkdir()
    (tmp_path / "fixture_worker.py").write_text(
        "from pathlib import Path\nimport os, time\n"
        "with Path('starts').open('a') as stream: stream.write(str(os.getpid())+'\\n')\n"
        "while True: time.sleep(1)\n"
    )
    launch = (
        "import importlib.util; from pathlib import Path; "
        f"spec=importlib.util.spec_from_file_location('watcher',{str(WATCHER)!r}); "
        "module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); "
        f"module.ROOT=Path({str(tmp_path)!r}); "
        "raise SystemExit(module.main(['fixture_worker']))"
    )
    watcher = subprocess.Popen([sys.executable, "-c", launch])
    children = []
    try:
        children = wait_for_starts(tmp_path / "starts", 1)
        changed = tmp_path / "apps" / "new_task.py"
        changed.write_text("VALUE = 1\n")
        children = wait_for_starts(tmp_path / "starts", 2)
        assert not process_exists(children[0])
        changed.unlink()
        children = wait_for_starts(tmp_path / "starts", 3)
        assert not process_exists(children[1])
    finally:
        watcher.send_signal(signal.SIGTERM)
        watcher.wait(timeout=15)
    assert watcher.returncode == 0
    assert all(not process_exists(pid) for pid in children)


def test_syntax_error_remains_watching_and_recovers_after_correction(tmp_path):
    (tmp_path / "apps").mkdir()
    (tmp_path / "config").mkdir()
    broken = tmp_path / "config" / "settings.py"
    broken.write_text("INVALID SYNTAX !!!\n")
    (tmp_path / "fixture_worker.py").write_text(
        "import config.settings\nfrom pathlib import Path\nimport os, time\n"
        "with Path('starts').open('a') as stream: stream.write(str(os.getpid())+'\\n')\n"
        "while True: time.sleep(1)\n"
    )
    launch = (
        "import importlib.util; from pathlib import Path; "
        f"spec=importlib.util.spec_from_file_location('watcher',{str(WATCHER)!r}); "
        "module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); "
        f"module.ROOT=Path({str(tmp_path)!r}); "
        "raise SystemExit(module.main(['fixture_worker']))"
    )
    watcher = subprocess.Popen([sys.executable, "-c", launch])
    children = []
    try:
        time.sleep(0.8)
        assert watcher.poll() is None
        assert not (tmp_path / "starts").exists()
        broken.write_text("VALUE = 1\n")
        children = wait_for_starts(tmp_path / "starts", 1)
    finally:
        watcher.send_signal(signal.SIGTERM)
        watcher.wait(timeout=15)
    assert watcher.returncode == 0
    assert all(not process_exists(pid) for pid in children)
