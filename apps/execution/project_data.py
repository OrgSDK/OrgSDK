"""Bounded run capabilities for human-managed project resources."""

import json

from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.agents.models import Agent

MAX_BYTES = 200_000


class StrictInteger(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail("invalid")
        return super().to_internal_value(data)


class StrictUUID(serializers.UUIDField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class StrictText(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class OperationSerializer(serializers.Serializer):
    operation = serializers.ChoiceField(
        choices=[
            "list_tables",
            "get_table",
            "list_rows",
            "write_row",
            "delete_row",
            "list_documents",
            "get_document",
            "write_document",
        ]
    )
    offset = StrictInteger(min_value=0, max_value=1_000_000, required=False, default=0)
    limit = StrictInteger(min_value=1, max_value=100, required=False, default=100)
    table_id = StrictUUID(required=False)
    document_id = StrictUUID(required=False)
    row_id = StrictUUID(required=False)
    revision = StrictInteger(min_value=1, max_value=9_007_199_254_740_991, required=False)
    table_revision = StrictInteger(min_value=1, max_value=9_007_199_254_740_991, required=False)
    values = serializers.DictField(required=False)
    title = StrictText(max_length=200, required=False)
    content = StrictText(
        max_length=200_000, allow_blank=True, required=False, trim_whitespace=False
    )

    def validate(self, attrs):
        try:
            request_bytes = json.dumps(
                self.initial_data, ensure_ascii=False, allow_nan=False
            ).encode("utf-8")
            if len(request_bytes) > MAX_BYTES:
                raise ValidationError("Request exceeds the 200000-byte JSON limit.")
        except (ValueError, UnicodeError, TypeError) as error:
            raise ValidationError("Use valid finite JSON parameters.") from error
        operation = attrs["operation"]
        params = {
            "list_tables": ({"offset", "limit"}, set()),
            "get_table": ({"table_id"}, {"table_id"}),
            "list_rows": ({"table_id", "offset", "limit"}, {"table_id"}),
            "write_row": (
                {"table_id", "table_revision", "values", "row_id", "revision"},
                {"table_id", "table_revision", "values"},
            ),
            "delete_row": ({"table_id", "row_id", "revision"}, {"table_id", "row_id", "revision"}),
            "list_documents": ({"offset", "limit"}, set()),
            "get_document": ({"document_id"}, {"document_id"}),
            "write_document": ({"document_id", "title", "content"}, {"document_id"}),
        }
        allowed, required = params[operation]
        if set(self.initial_data) - allowed - {"operation"} or required - attrs.keys():
            raise ValidationError("Supply only the parameters required by this operation.")
        if operation == "write_row" and (("row_id" in attrs) != ("revision" in attrs)):
            raise ValidationError("Row updates require both row_id and revision.")
        return {key: value for key, value in attrs.items() if key in allowed | {"operation"}}


def resource_ids(run, kind, *, write=False):
    """Intersect immutable root grants with current grants; write also permits reads."""
    root = next(
        (item for item in run.snapshot.get("agents", []) if item.get("id") == str(run.agent_id)), {}
    )
    grants = root.get("resources", {}).get(kind, {})
    snapshot_ids = set(grants.get("write", []))
    if not write:
        snapshot_ids.update(grants.get("read", []))
    agent = Agent.objects.filter(pk=run.agent_id, workspace=run.workspace).first()
    if agent is None:
        return set()
    current = set(
        str(pk)
        for pk in getattr(agent, "writable_" + kind)
        .filter(workspace=run.workspace)
        .values_list("pk", flat=True)
    )
    if not write:
        current.update(
            str(pk)
            for pk in getattr(agent, "readable_" + kind)
            .filter(workspace=run.workspace)
            .values_list("pk", flat=True)
        )
    return snapshot_ids & current


def require_resource(run, kind, resource_id, *, write=False):
    if str(resource_id) not in resource_ids(run, kind, write=write):
        raise PermissionDenied("Resource is outside this project's run grant.")


def bounded(value):
    try:
        size = len(
            json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
    except (ValueError, UnicodeError, TypeError) as error:
        raise ValidationError("Resource must contain valid finite JSON.") from error
    if size > MAX_BYTES:
        raise ValidationError(
            "Resource exceeds the 200000-byte response limit. "
            "Reduce its size before reading it through the SDK."
        )
    return value


def page(query, serializer, *, offset, limit):
    records = list(query.order_by("pk")[offset : offset + limit + 1])
    items = []
    for record in records[:limit]:
        item = bounded(serializer(record).data)
        candidate = {"items": items + [item], "next_offset": offset + len(items) + 1}
        if (
            len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            > MAX_BYTES
        ):
            if not items:
                bounded(candidate)
            return {"items": items, "next_offset": offset + len(items)}
        items.append(item)
    return bounded(
        {"items": items, "next_offset": offset + len(items) if len(records) > limit else None}
    )
