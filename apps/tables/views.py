from drf_spectacular.utils import extend_schema
from rest_framework import generics, mixins, viewsets
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from apps.workspaces.services import active_membership

from . import services
from .models import TableRow, WorkspaceTable
from .parsers import TableJSONParser
from .serializers import (
    RevisionSerializer,
    RowSerializer,
    RowUpdateSerializer,
    RowWriteSerializer,
    TableSerializer,
    TableUpdateSerializer,
)


class TableViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = WorkspaceTable.objects.all()
    parser_classes = [TableJSONParser]
    serializer_class = TableSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        return self.queryset.filter(workspace=active_membership(self.request).workspace).order_by(
            "created_at", "pk"
        )

    def context_arguments(self):
        return {"workspace": active_membership(self.request).workspace, "actor": self.request.user}

    @extend_schema(request=TableSerializer, responses={201: TableSerializer})
    def create(self, request):
        data = TableSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        table = services.create_table(**self.context_arguments(), **data.validated_data)
        return Response(TableSerializer(table).data, status=201)

    @extend_schema(request=TableUpdateSerializer, responses=TableSerializer)
    def update(self, request, pk=None):
        data = TableUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        table = services.update_table(
            **self.context_arguments(), table_id=pk, **data.validated_data
        )
        return Response(TableSerializer(table).data)

    @extend_schema(parameters=[RevisionSerializer], responses={204: None})
    def destroy(self, request, pk=None):
        data = RevisionSerializer(data=request.query_params)
        data.is_valid(raise_exception=True)
        services.delete_table(**self.context_arguments(), table_id=pk, **data.validated_data)
        return Response(status=204)


class RowListView(generics.ListCreateAPIView):
    parser_classes = [TableJSONParser]
    serializer_class = RowSerializer
    queryset = TableRow.objects.all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        table = get_object_or_404(
            WorkspaceTable,
            pk=self.kwargs["table_id"],
            workspace=active_membership(self.request).workspace,
        )
        return self.queryset.filter(table=table).order_by("created_at", "pk")

    @extend_schema(request=RowWriteSerializer, responses={201: RowSerializer})
    def post(self, request, table_id):
        data = RowWriteSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        row = services.write_row(
            workspace=active_membership(request).workspace,
            actor=request.user,
            table_id=table_id,
            **data.validated_data,
        )
        return Response(RowSerializer(row).data, status=201)


class RowDetailView(generics.GenericAPIView):
    parser_classes = [TableJSONParser]
    serializer_class = RowSerializer

    @extend_schema(request=RowUpdateSerializer, responses=RowSerializer)
    def put(self, request, table_id, row_id):
        data = RowUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        row = services.write_row(
            workspace=active_membership(request).workspace,
            actor=request.user,
            table_id=table_id,
            row_id=row_id,
            **data.validated_data,
        )
        return Response(RowSerializer(row).data)

    @extend_schema(parameters=[RevisionSerializer], responses={204: None})
    def delete(self, request, table_id, row_id):
        data = RevisionSerializer(data=request.query_params)
        data.is_valid(raise_exception=True)
        services.delete_row(
            workspace=active_membership(request).workspace,
            actor=request.user,
            table_id=table_id,
            row_id=row_id,
            **data.validated_data,
        )
        return Response(status=204)
