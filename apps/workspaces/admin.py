from django.contrib import admin

from .models import Domain, Workspace


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "created_at"]
    readonly_fields = ["name", "created_at"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(Domain)
