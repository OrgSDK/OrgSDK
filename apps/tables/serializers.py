from rest_framework import serializers

from .models import TableRow, WorkspaceTable
from .services import safe_text, validate_columns


class ColumnSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=48)
    type = serializers.ChoiceField(choices=["text", "number", "boolean", "date"])
    required = serializers.BooleanField()


class TableSerializer(serializers.ModelSerializer):
    columns = ColumnSerializer(many=True, min_length=1, max_length=50)

    class Meta:
        model = WorkspaceTable
        fields = ["id", "name", "columns", "revision", "created_at", "updated_at"]
        read_only_fields = ["id", "revision", "created_at", "updated_at"]

    def validate_columns(self, value):
        return validate_columns(value)

    def validate_name(self, value):
        if not safe_text(value, 120):
            raise serializers.ValidationError("Enter a valid table name.")
        return value


class TableUpdateSerializer(TableSerializer):
    revision = serializers.IntegerField(min_value=1)


class RowSerializer(serializers.ModelSerializer):
    values = serializers.DictField(child=serializers.JSONField(), read_only=True)

    class Meta:
        model = TableRow
        fields = ["id", "values", "revision", "created_at", "updated_at"]
        read_only_fields = fields


class RowWriteSerializer(serializers.Serializer):
    table_revision = serializers.IntegerField(min_value=1)
    values = serializers.DictField(child=serializers.JSONField())


class RowUpdateSerializer(RowWriteSerializer):
    revision = serializers.IntegerField(min_value=1)


class RevisionSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
