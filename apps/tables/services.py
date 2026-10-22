"""Typed workspace data, independent of HTTP and executor infrastructure."""

import math
import re
from datetime import date

from django.db import transaction
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404

from apps.audit.services import audit
from apps.workspaces.models import Membership, Workspace
from apps.workspaces.services import require_manager

from .models import TableRow, WorkspaceTable


class RevisionConflict(APIException):
    status_code = 409
    default_detail = "This record changed. Reload it before saving again."


def safe_text(value, limit):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        return False
    try:
        value.encode("utf-8")
    except UnicodeError:
        return False
    return True


def validate_name(name):
    if not safe_text(name, 120) or not name.strip():
        raise ValidationError(
            {"name": "Enter a valid nonempty table name (120 characters maximum)."}
        )
    return name


def validate_columns(columns):
    if not isinstance(columns, list) or not 1 <= len(columns) <= 50:
        raise ValidationError({"columns": "Define between 1 and 50 columns."})
    names = set()
    for column in columns:
        if not isinstance(column, dict) or set(column) != {"key", "type", "required"}:
            raise ValidationError({"columns": "Each column needs key, type and required fields."})
        key = column["key"]
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,47}", key):
            raise ValidationError(
                {
                    "columns": (
                        "Keys use lowercase letters, digits and underscores; "
                        "start with a letter (48 characters maximum)."
                    )
                }
            )
        if key in names:
            raise ValidationError({"columns": f"Duplicate column key: {key}."})
        if (
            column["type"] not in ("text", "number", "boolean", "date")
            or type(column["required"]) is not bool
        ):
            raise ValidationError(
                {"columns": "Choose text, number, boolean or date and a boolean required flag."}
            )
        names.add(key)
    return columns


def validate_values(columns, values):
    if not isinstance(values, dict) or set(values) - {column["key"] for column in columns}:
        raise ValidationError({"values": "Use an object containing only defined column keys."})
    errors = {}
    for column in columns:
        key = column["key"]
        value = values.get(key)
        if value is None:
            if column["required"]:
                errors[key] = "A value is required."
            continue
        kind = column["type"]
        valid = False
        if kind == "text":
            valid = safe_text(value, 10_000) and (not column["required"] or bool(value.strip()))
        elif kind == "number":
            valid = (
                type(value) in (int, float) and -1e100 <= value <= 1e100 and math.isfinite(value)
            )
        elif kind == "boolean":
            valid = type(value) is bool
        elif (
            kind == "date" and isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)
        ):
            try:
                date.fromisoformat(value)
                valid = True
            except ValueError:
                pass
        if not valid:
            errors[key] = (
                f"Enter a valid {kind} value. "
                "Text is limited to 10,000 characters; numbers to ±1e100."
            )
    if errors:
        raise ValidationError({"values": errors})
    return values


def lock_actor(workspace, actor, *, manage=False):
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    membership = Membership.objects.filter(workspace=workspace, user=actor).first()
    if membership is None:
        raise PermissionDenied("You no longer belong to this workspace.")
    if manage:
        require_manager(membership)


def check_revision(record, revision):
    if revision != record.revision:
        raise RevisionConflict()


@transaction.atomic
def create_table(*, workspace, actor, name, columns):
    lock_actor(workspace, actor, manage=True)
    table = WorkspaceTable.objects.create(
        workspace=workspace, name=validate_name(name), columns=validate_columns(columns)
    )
    audit(workspace, actor, "table.created", table)
    return table


@transaction.atomic
def update_table(*, workspace, actor, table_id, revision, name, columns):
    lock_actor(workspace, actor, manage=True)
    table = get_object_or_404(WorkspaceTable, workspace=workspace, pk=table_id)
    check_revision(table, revision)
    validate_columns(columns)
    for row in table.rows.iterator():
        try:
            validate_values(columns, row.values)
        except ValidationError as error:
            raise ValidationError(
                {
                    "columns": (
                        f"Schema would invalidate row {row.pk}. "
                        "Keep populated columns and compatible types; edit rows first."
                    ),
                    "row_errors": error.detail,
                }
            ) from error
    table.name, table.columns = validate_name(name), columns
    table.revision += 1
    table.save()
    audit(workspace, actor, "table.updated", table)
    return table


@transaction.atomic
def delete_table(*, workspace, actor, table_id, revision):
    lock_actor(workspace, actor, manage=True)
    table = get_object_or_404(WorkspaceTable, workspace=workspace, pk=table_id)
    check_revision(table, revision)
    audit(workspace, actor, "table.deleted", table)
    table.delete()


@transaction.atomic
def write_row(*, workspace, actor, table_id, table_revision, values, row_id=None, revision=None):
    lock_actor(workspace, actor)
    table = get_object_or_404(WorkspaceTable, workspace=workspace, pk=table_id)
    check_revision(table, table_revision)
    validate_values(table.columns, values)
    if row_id is None:
        row = TableRow.objects.create(table=table, values=values)
        audit(workspace, actor, "row.created", row)
        return row
    row = get_object_or_404(TableRow, table=table, pk=row_id)
    check_revision(row, revision)
    row.values = values
    row.revision += 1
    row.save()
    audit(workspace, actor, "row.updated", row)
    return row


@transaction.atomic
def delete_row(*, workspace, actor, table_id, row_id, revision):
    lock_actor(workspace, actor)
    row = get_object_or_404(TableRow, table__workspace=workspace, table_id=table_id, pk=row_id)
    check_revision(row, revision)
    audit(workspace, actor, "row.deleted", row)
    row.delete()
