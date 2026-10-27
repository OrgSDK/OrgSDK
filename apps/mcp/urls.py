from django.urls import path

from .views import MCPView

urlpatterns = [path("", MCPView.as_view(), name="mcp")]
