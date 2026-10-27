"""Run-scoped table operations using the table domain's mutation rules."""

from rest_framework.generics import get_object_or_404

from apps.execution.project_data import bounded, page, require_resource, resource_ids

from .models import WorkspaceTable
from .serializers import RowSerializer, TableSerializer
from .services import delete_row, write_row


def execute(run, operation, params):
    tables = WorkspaceTable.objects.filter(
        workspace=run.workspace, pk__in=resource_ids(run, "tables")
    )
    if operation == "list_tables":
        return page(tables, TableSerializer, **params)
    table_id = params["table_id"]
    require_resource(run, "tables", table_id, write=operation in {"write_row", "delete_row"})
    table = get_object_or_404(tables, pk=table_id)
    if operation == "get_table":
        return bounded(TableSerializer(table).data)
    if operation == "list_rows":
        return page(table.rows.all(), RowSerializer, offset=params["offset"], limit=params["limit"])
    if operation == "write_row":
        row = write_row(workspace=run.workspace, actor=run.actor, **params)
        return bounded(RowSerializer(row).data)
    delete_row(workspace=run.workspace, actor=run.actor, **params)
    return {"deleted": True}
