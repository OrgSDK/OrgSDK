from django.contrib import admin

from .models import BackgroundJob


@admin.register(BackgroundJob)
class BackgroundJobAdmin(admin.ModelAdmin):
    list_display = ["id", "task", "status", "attempts", "available_at", "last_error"]
    list_filter = ["status", "task"]
    readonly_fields = [field.name for field in BackgroundJob._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
