import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.tables.models import TableRow, WorkspaceTable
from apps.tables.services import RevisionConflict, write_row
from apps.workspaces.models import Membership
from tests.test_product import environment  # noqa: F401

pytestmark = pytest.mark.django_db
COLUMNS = [
    {"key": "title", "type": "text", "required": True},
    {"key": "amount", "type": "number", "required": False},
    {"key": "done", "type": "boolean", "required": False},
    {"key": "due", "type": "date", "required": False},
]


@pytest.fixture
def table_env(request):
    env = request.getfixturevalue("environment")
    response = env[0].post("/api/v1/tables/", {"name": "Tasks", "columns": COLUMNS}, format="json")
    assert response.status_code == 201, response.data
    return env, response.data


def add_row(client, table, values=None):
    return client.post(
        f"/api/v1/tables/{table['id']}/rows/",
        {
            "table_revision": table["revision"],
            "values": values
            or {"title": "First", "amount": 1.5, "done": False, "due": "2026-10-20"},
        },
        format="json",
    )


def test_row_crud_and_conflicts(table_env):
    env, table = table_env
    client = env[0]
    created = add_row(client, table)
    assert created.status_code == 201, created.data
    row = created.data
    url = f"/api/v1/tables/{table['id']}/rows/{row['id']}/"
    body = {"table_revision": 1, "revision": 1, "values": {"title": "Changed"}}
    assert client.put(url, body, format="json").data["revision"] == 2
    assert client.put(url, body, format="json").status_code == 409
    assert client.delete(url + "?revision=1").status_code == 409
    assert client.delete(url + "?revision=2").status_code == 204
    assert not TableRow.objects.exists()
    assert client.delete(f"/api/v1/tables/{table['id']}/?revision=1").status_code == 204
    assert not WorkspaceTable.objects.exists()


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"title": None},
        {"title": " "},
        {"title": []},
        {"title": "x", "unknown": 1},
        {"title": "x", "amount": True},
        {"title": "x", "amount": 1e101},
        {"title": "x", "done": 1},
        {"title": "x", "due": "2026-02-30"},
        {"title": "x\x00"},
        {"title": "\ud800"},
        {"title": "x" * 10001},
    ],
)
def test_invalid_rows(table_env, values):
    env, table = table_env
    response = env[0].post(
        f"/api/v1/tables/{table['id']}/rows/",
        json.dumps({"table_revision": 1, "values": values}),
        content_type="application/json",
    )
    assert response.status_code == 400, response.data
    assert not TableRow.objects.exists()


@pytest.mark.parametrize(
    "columns",
    [
        [],
        COLUMNS * 2,
        [{"key": "Bad key", "type": "text", "required": False}],
        [{"key": "x", "type": "object", "required": False}],
        COLUMNS * 51,
    ],
)
def test_invalid_columns(request, columns):
    env = request.getfixturevalue("environment")
    assert (
        env[0]
        .post("/api/v1/tables/", {"name": "Bad", "columns": columns}, format="json")
        .status_code
        == 400
    )


def test_schema_preserves_rows_and_checks_revisions(table_env):
    env, table = table_env
    client = env[0]
    row = add_row(client, table).data
    url = f"/api/v1/tables/{table['id']}/"
    for columns in [
        COLUMNS[1:],
        [
            {**column, "type": "number"} if column["key"] == "title" else column
            for column in COLUMNS
        ],
        [*COLUMNS, {"key": "extra", "type": "text", "required": True}],
    ]:
        response = client.put(
            url, {"name": "Tasks", "columns": columns, "revision": 1}, format="json"
        )
        assert response.status_code == 400, response.data
    assert TableRow.objects.get().values == row["values"]
    assert WorkspaceTable.objects.get().revision == 1
    columns = [*COLUMNS, {"key": "extra", "type": "text", "required": False}]
    assert (
        client.put(url, {"name": "Renamed", "columns": columns, "revision": 1}, format="json").data[
            "revision"
        ]
        == 2
    )
    assert add_row(client, table).status_code == 409
    assert (
        client.put(
            url, {"name": "Stale", "columns": columns, "revision": 1}, format="json"
        ).status_code
        == 409
    )
    assert client.delete(url + "?revision=1").status_code == 409


def test_roles_isolation_and_csrf(table_env):
    env, table = table_env
    url = f"/api/v1/tables/{table['id']}/"
    client = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    assert client.get("/api/v1/tables/").status_code == 403
    client.force_login(env[1])
    assert client.post("/api/v1/tables/", {}, format="json").status_code == 403
    csrf = client.get("/api/v1/session/").cookies["csrftoken"].value
    client.credentials(HTTP_X_CSRFTOKEN=csrf)
    Membership.objects.filter(workspace=env[2], user=env[1]).update(role="member")
    assert client.get(url).status_code == 200
    assert (
        client.post(
            "/api/v1/tables/", {"name": "Denied", "columns": COLUMNS}, format="json"
        ).status_code
        == 403
    )
    assert (
        client.put(
            url, {"name": "Denied", "columns": COLUMNS, "revision": 1}, format="json"
        ).status_code
        == 403
    )
    assert client.delete(url + "?revision=1").status_code == 403
    assert add_row(client, table).status_code == 201
    Membership.objects.create(user=env[1], workspace=env[3], role="admin")
    for path in [url, url + "rows/"]:
        assert client.get(path, HTTP_HOST="other.example.test").status_code == 404
    assert client.get("/api/v1/tables/", HTTP_HOST="other.example.test").data["count"] == 0
    assert (
        client.post(
            url + "rows/",
            {"table_revision": 1, "values": {"title": "Foreign"}},
            format="json",
            HTTP_HOST="other.example.test",
        ).status_code
        == 404
    )
    Membership.objects.filter(workspace=env[2], user=env[1]).delete()
    assert client.get(url).status_code == 403


def test_rows_are_paginated(table_env):
    env, table = table_env
    TableRow.objects.bulk_create(
        [TableRow(table_id=table["id"], values={"title": str(index)}) for index in range(101)]
    )
    page = env[0].get(f"/api/v1/tables/{table['id']}/rows/").data
    assert page["count"] == 101
    assert page["next"]
    assert len(page["results"]) < 101


@pytest.mark.django_db(transaction=True)
def test_concurrent_row_updates_conflict(table_env):
    env, table = table_env
    row = add_row(env[0], table).data

    def edit(index):
        close_old_connections()
        try:
            write_row(
                workspace=env[2],
                actor=env[1],
                table_id=table["id"],
                table_revision=1,
                row_id=row["id"],
                revision=1,
                values={"title": str(index)},
            )
            return 200
        except RevisionConflict:
            return 409
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, range(2))) == [200, 409]
    assert TableRow.objects.get().revision == 2


@pytest.mark.parametrize(
    "body",
    [
        b"[" * 100 + b"0" + b"]" * 100,
        b"[" * 2000,
        b"x" * 1_048_577,
        b'{"values":{"title":NaN}}',
        b"\xff",
    ],
)
def test_invalid_json_is_rejected(table_env, body):
    env, table = table_env
    response = env[0].post(
        f"/api/v1/tables/{table['id']}/rows/", body, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.parametrize("name", ["", "x\x00", "\ud800", "x" * 121])
def test_invalid_table_names(request, name):
    env = request.getfixturevalue("environment")
    response = env[0].post(
        "/api/v1/tables/",
        json.dumps({"name": name, "columns": COLUMNS}),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_mutations_audit_metadata_only(table_env):
    env, table = table_env
    client = env[0]
    row = add_row(client, table, {"title": "private-row-content"}).data
    row_url = f"/api/v1/tables/{table['id']}/rows/{row['id']}/"
    assert (
        client.put(
            row_url,
            {"revision": 1, "table_revision": 1, "values": {"title": "updated-private-content"}},
            format="json",
        ).status_code
        == 200
    )
    assert client.delete(row_url + "?revision=2").status_code == 204
    table_url = f"/api/v1/tables/{table['id']}/"
    assert (
        client.put(
            table_url,
            {"name": "Private table name", "columns": COLUMNS, "revision": 1},
            format="json",
        ).status_code
        == 200
    )
    assert client.delete(table_url + "?revision=2").status_code == 204
    events = list(
        AuditEvent.objects.filter(workspace=env[2])
        .order_by("created_at")
        .values("kind", "object_id", "actor_id")
    )
    assert [event["kind"] for event in events] == [
        "table.created",
        "row.created",
        "row.updated",
        "row.deleted",
        "table.updated",
        "table.deleted",
    ]
    assert all(event["actor_id"] == env[1].pk for event in events)
    assert {event["object_id"] for event in events} == {str(table["id"]), str(row["id"])}
    persisted = json.dumps(list(AuditEvent.objects.values()), default=str)
    assert "private-row-content" not in persisted
    assert "updated-private-content" not in persisted
    assert "Private table name" not in persisted


def test_malformed_table_identifier_returns_not_found(table_env):
    env, _ = table_env
    assert (
        env[0]
        .put(
            "/api/v1/tables/not-a-uuid/",
            {"name": "Bad", "columns": COLUMNS, "revision": 1},
            format="json",
        )
        .status_code
        == 404
    )
    assert env[0].delete("/api/v1/tables/not-a-uuid/?revision=1").status_code == 404
