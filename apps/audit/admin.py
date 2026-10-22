from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditAdmin(admin.ModelAdmin):
    list_display = ["created_at", "workspace", "actor", "kind", "object_id"]
    readonly_fields = ["workspace", "actor", "kind", "object_id", "created_at", "updated_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
