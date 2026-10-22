"""Shared API authorization and auditing for workspace-owned records."""

from django.db.models.deletion import ProtectedError
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError

from apps.actions.models import Action
from apps.agents.models import Agent
from apps.audit.services import audit
from apps.runs.models import Run
from apps.workspaces.services import active_membership, require_manager


class WorkspaceSerializer(serializers.ModelSerializer):
    """Related records must belong to the authenticated request workspace."""

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        for field in fields.values():
            relation = (
                field.child_relation if isinstance(field, serializers.ManyRelatedField) else field
            )
            if (
                isinstance(relation, serializers.PrimaryKeyRelatedField)
                and relation.queryset is not None
            ):
                workspace = getattr(request, "workspace", None)
                workspace_field = (
                    "action__workspace"
                    if relation.queryset.model._meta.label_lower == "actions.actionversion"
                    else "workspace"
                )
                relation.queryset = relation.queryset.filter(**{workspace_field: workspace})
                from apps.api_access.policy import permitted_queryset

                relation.queryset = permitted_queryset(
                    getattr(request, "auth", None), relation.queryset, authoring=True
                )
                capability = getattr(request, "auth", None)
                if isinstance(capability, Run):
                    model = relation.queryset.model
                    agent_ids = [agent["id"] for agent in capability.snapshot["agents"]]
                    if model is Agent:
                        relation.queryset = relation.queryset.filter(pk__in=agent_ids)
                    elif model is Run:
                        relation.queryset = relation.queryset.filter(pk=capability.pk)
                    elif model is Action:
                        relation.queryset = relation.queryset.filter(agent_id__in=agent_ids)
        return fields


class WorkspaceViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        active_membership(self.request)
        from apps.api_access.policy import permitted_queryset

        return permitted_queryset(
            self.request.auth,
            self.queryset.filter(workspace=self.request.workspace),
            authoring=self.request.method not in {"GET", "HEAD", "OPTIONS"},
        ).order_by("pk")

    def perform_create(self, serializer):
        active_membership(self.request)
        obj = serializer.save(workspace=self.request.workspace)
        audit(obj.workspace, self.request.user, f"{obj._meta.model_name}.created", obj)

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(obj.workspace, self.request.user, f"{obj._meta.model_name}.updated", obj)

    def perform_destroy(self, instance):
        audit(
            instance.workspace, self.request.user, f"{instance._meta.model_name}.deleted", instance
        )
        try:
            instance.delete()
        except ProtectedError as error:
            raise ValidationError("This record is referenced by retained run history.") from error


class ManagedViewSet(WorkspaceViewSet):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            require_manager(active_membership(request))
