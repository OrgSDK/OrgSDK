from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.jobs import enqueue

from .models import Invitation, Membership
from .serializers import (
    InvitationSerializer,
    MemberSerializer,
    RoleSerializer,
    TransferSerializer,
    WorkspaceDetailSerializer,
    WorkspaceSerializer,
    WorkspaceSummarySerializer,
)
from .services import (
    MANAGER_ROLES,
    accept_invitation,
    active_membership,
    lock_membership,
    require_manager,
    require_member_management,
)


@method_decorator(never_cache, name="dispatch")
class WorkspaceAPIView(APIView):
    pass


class WorkspaceListView(WorkspaceAPIView):
    @extend_schema(responses=WorkspaceSummarySerializer(many=True))
    def get(self, request):
        memberships = request.user.memberships.select_related("workspace").order_by("pk")
        if settings.WORKSPACE_DOMAIN_ROUTING:
            memberships = memberships.filter(workspace=request.workspace)
        selected = active_membership(request).workspace_id if memberships.exists() else None
        return Response(
            WorkspaceSummarySerializer(
                [
                    {
                        "id": m.workspace_id,
                        "name": m.workspace.name,
                        "role": m.role,
                        "is_active": m.workspace_id == selected,
                    }
                    for m in memberships
                ],
                many=True,
            ).data
        )

    @extend_schema(request=WorkspaceSerializer, responses={201: WorkspaceSerializer})
    @transaction.atomic
    def post(self, request):
        if settings.WORKSPACE_DOMAIN_ROUTING:
            raise PermissionDenied("Workspace provisioning is operator-managed.")
        serializer = WorkspaceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = serializer.save()
        Membership.objects.create(workspace=workspace, user=request.user, role="owner")
        request.session["workspace_id"] = workspace.pk
        return Response(serializer.data, status=201)


class WorkspaceDetailView(WorkspaceAPIView):
    @extend_schema(responses=WorkspaceDetailSerializer)
    def get(self, request):
        membership = active_membership(request)
        workspace = membership.workspace
        invitations = (
            workspace.invitations.order_by("-pk") if membership.role in MANAGER_ROLES else []
        )
        return Response(
            WorkspaceDetailSerializer(
                {
                    "workspace": workspace,
                    "role": membership.role,
                    "members": workspace.memberships.select_related("user").order_by("pk"),
                    "invitations": invitations,
                }
            ).data
        )

    @extend_schema(request=WorkspaceSerializer, responses=WorkspaceSerializer)
    @transaction.atomic
    def patch(self, request):
        membership = lock_membership(request)
        require_manager(membership)
        serializer = WorkspaceSerializer(membership.workspace, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class WorkspaceSelectView(WorkspaceAPIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request, pk):
        if settings.WORKSPACE_DOMAIN_ROUTING:
            raise PermissionDenied("Use the workspace domain to select a workspace.")
        membership = get_object_or_404(Membership, workspace_id=pk, user=request.user)
        request.session["workspace_id"] = membership.workspace_id
        return Response(status=204)


class MemberView(WorkspaceAPIView):
    @extend_schema(request=RoleSerializer, responses=MemberSerializer)
    @transaction.atomic
    def patch(self, request, pk):
        actor = lock_membership(request)
        target = get_object_or_404(Membership, pk=pk, workspace_id=actor.workspace_id)
        require_member_management(actor, target)
        if actor.role != "owner":
            raise PermissionDenied("Only the owner can change roles.")
        serializer = RoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target.role = serializer.validated_data["role"]
        target.save(update_fields=["role"])
        return Response(MemberSerializer(target).data)

    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, pk):
        actor = lock_membership(request)
        target = get_object_or_404(Membership, pk=pk, workspace_id=actor.workspace_id)
        if target.pk == actor.pk and actor.role != "owner":
            target.delete()
            return Response(status=204)
        require_member_management(actor, target)
        target.delete()
        return Response(status=204)


class OwnershipView(WorkspaceAPIView):
    @extend_schema(request=TransferSerializer, responses={204: None})
    @transaction.atomic
    def post(self, request):
        actor = lock_membership(request)
        if actor.role != "owner":
            raise PermissionDenied("Only the owner can transfer ownership.")
        serializer = TransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = get_object_or_404(
            Membership,
            workspace_id=actor.workspace_id,
            pk=serializer.validated_data["membership_id"],
        )
        if target.pk == actor.pk:
            raise ValidationError("Select another member as owner.")
        actor.role = "admin"
        actor.save(update_fields=["role"])
        target.role = "owner"
        target.save(update_fields=["role"])
        return Response(status=204)


class InvitationCreateView(WorkspaceAPIView):
    @extend_schema(request=InvitationSerializer, responses={201: InvitationSerializer})
    @transaction.atomic
    def post(self, request):
        actor = lock_membership(request)
        require_manager(actor)
        serializer = InvitationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        if actor.role != "owner" and serializer.validated_data["role"] == "admin":
            raise PermissionDenied("Only the owner can invite admins.")
        if Membership.objects.filter(
            workspace_id=actor.workspace_id, user__email__iexact=email
        ).exists():
            raise ValidationError("This email already belongs to a workspace member.")
        pending = Invitation.objects.filter(
            workspace_id=actor.workspace_id, email__iexact=email, accepted_at=None, revoked_at=None
        )
        pending.filter(expires_at__lte=timezone.now()).update(revoked_at=timezone.now())
        if pending.exists():
            raise ValidationError(
                "A pending invitation already exists. Revoke it before inviting again."
            )
        invitation = serializer.save(workspace_id=actor.workspace_id)
        enqueue("send_invitation", invitation_id=invitation.pk)
        return Response(serializer.data, status=201)


class InvitationRevokeView(WorkspaceAPIView):
    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, pk):
        actor = lock_membership(request)
        require_manager(actor)
        invitation = get_object_or_404(Invitation, pk=pk, workspace_id=actor.workspace_id)
        if actor.role != "owner" and invitation.role == "admin":
            raise PermissionDenied("Only the owner can revoke admin invitations.")
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=["revoked_at"])
        return Response(status=204)


class InvitationAcceptView(WorkspaceAPIView):
    @extend_schema(request=None, responses=WorkspaceSerializer)
    def post(self, request, token):
        return Response(WorkspaceSerializer(accept_invitation(request, token)).data)
