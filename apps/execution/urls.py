from django.urls import path

from . import views
from .capabilities import urlpatterns as capability_urls

urlpatterns = [
    path("bootstrap/", views.BootstrapView.as_view()),
    path("configuration/", views.ConfigurationView.as_view()),
    path("runs/<uuid:run_id>/delegate/", views.DelegateView.as_view()),
    path(
        "runs/<uuid:run_id>/delegations/<uuid:child_id>/result/",
        views.DelegationResultView.as_view(),
    ),
    path("register/", views.RegisterView.as_view()),
    path("claim/", views.ClaimView.as_view()),
    path("runs/<uuid:run_id>/heartbeat/", views.HeartbeatView.as_view()),
    path("runs/<uuid:run_id>/events/", views.EventView.as_view()),
    path("runs/<uuid:run_id>/complete/", views.CompleteView.as_view()),
    path("credentials/<uuid:credential_id>/", views.SecretView.as_view()),
]


urlpatterns += capability_urls
