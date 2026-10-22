from django.http import JsonResponse
from django.views.decorators.http import require_safe


@require_safe
def health(request):
    """Liveness probe; intentionally independent of external services."""
    return JsonResponse({"status": "ok"})
