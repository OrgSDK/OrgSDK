from django.urls import path

from .views import (
    InvitationAcceptView,
    InvitationCreateView,
    InvitationRevokeView,
    MemberView,
    OwnershipView,
    WorkspaceDetailView,
    WorkspaceListView,
    WorkspaceSelectView,
)

urlpatterns = [
    path("", WorkspaceListView.as_view()),
    path("current/", WorkspaceDetailView.as_view()),
    path("<int:pk>/select/", WorkspaceSelectView.as_view()),
    path("members/<int:pk>/", MemberView.as_view()),
    path("ownership/", OwnershipView.as_view()),
    path("invitations/", InvitationCreateView.as_view()),
    path("invitations/<int:pk>/", InvitationRevokeView.as_view()),
    path("invitations/<uuid:token>/accept/", InvitationAcceptView.as_view()),
]
