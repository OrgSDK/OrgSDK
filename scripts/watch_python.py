"""Restart one owned development command when Django source files change."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source_snapshot(root: Path) -> dict[Path, int]:
    paths = [root / "manage.py"]
    for directory in (root / "apps", root / "config"):
        paths.extend(directory.rglob("*.py"))
    snapshot = {}
    for path in paths:
        try:
            snapshot[path] = path.stat().st_mtime_ns
        except FileNotFoundError:
            continue
    return snapshot


def stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main(arguments: list[str]) -> int:
    if arguments and arguments[0] == "--":
        arguments = arguments[1:]
    if not arguments:
        raise SystemExit("Usage: watch_python.py -- python-module [arguments ...]")
    stopping = False

    def request_stop(_number: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    snapshot = source_snapshot(ROOT)
    process = subprocess.Popen([sys.executable, "-m", *arguments], cwd=ROOT, start_new_session=True)
    reported_exit = False
    try:
        while not stopping:
            status = process.poll()
            if status is not None and not reported_exit:
                print(
                    f"{arguments[0]} exited ({status}); waiting for source changes to retry.",
                    flush=True,
                )
                reported_exit = True
            time.sleep(0.5)
            current = source_snapshot(ROOT)
            if current == snapshot:
                continue
            snapshot = current
            print(f"Django source changed; restarting {arguments[0]}.", flush=True)
            stop_process(process)
            if stopping:
                break
            process = subprocess.Popen(
                [sys.executable, "-m", *arguments], cwd=ROOT, start_new_session=True
            )
            reported_exit = False
    finally:
        stop_process(process)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
