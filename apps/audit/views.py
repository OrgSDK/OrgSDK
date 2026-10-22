from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination

from apps.workspaces.models import Membership
from apps.workspaces.services import active_membership, require_manager

from .models import AuditEvent
from .serializers import AuditEventSerializer, AuditFilterSerializer


class AuditPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


@extend_schema(parameters=[AuditFilterSerializer])
class AuditListView(generics.ListAPIView):
    serializer_class = AuditEventSerializer
    pagination_class = AuditPagination
    queryset = AuditEvent.objects.all()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset.none()
        membership = active_membership(self.request)
        require_manager(membership)
        filters = AuditFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        self.member_ids = set(
            Membership.objects.filter(workspace=membership.workspace).values_list(
                "user_id", flat=True
            )
        )
        queryset = self.queryset.filter(workspace=membership.workspace).select_related("actor")
        lookups = {
            "kind": "kind",
            "actor": "actor_id",
            "object_id": "object_id",
            "since": "created_at__gte",
            "before": "created_at__lt",
        }
        for name, lookup in lookups.items():
            if name in filters.validated_data:
                queryset = queryset.filter(**{lookup: filters.validated_data[name]})
        return queryset.order_by("-created_at", "-pk")

    def get_serializer_context(self):
        return {
            **super().get_serializer_context(),
            "member_ids": getattr(self, "member_ids", set()),
        }
