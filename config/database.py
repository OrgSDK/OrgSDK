from pathlib import Path


def sqlite_database(path):
    """Acquire the write reservation before reading inside an atomic service operation."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return {
        "ENGINE": "config.sqlite",
        "NAME": str(path),
        "OPTIONS": {
            "timeout": 20,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        },
    }
