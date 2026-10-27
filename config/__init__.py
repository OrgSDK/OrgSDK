"""Use the same bundled, WAL-fixed SQLite engine in development and deployment."""

import sys

import pysqlite3

if pysqlite3.sqlite_version_info < (3, 51, 3):
    raise RuntimeError("OrgSDK requires SQLite 3.51.3 or newer for the WAL reset fix.")

sys.modules["sqlite3"] = pysqlite3
sys.modules["sqlite3.dbapi2"] = pysqlite3.dbapi2
