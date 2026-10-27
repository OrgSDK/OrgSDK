"""Local aggregate observations of requests with accepted token identities."""

from django.db.models import Case, F, Q, Value, When
from django.utils import timezone

from .models import AccessToken


def record_activity(token_id, *, transport, status_code, failed):
    """One atomic update prevents lost counters or mismatched last-outcome fields."""
    now = timezone.now()
    latest = Q(last_used_at__isnull=True) | Q(last_used_at__lte=now)
    outcome = "error" if failed else "success"
    AccessToken.objects.filter(pk=token_id).update(
        first_used_at=Case(
            When(Q(first_used_at__isnull=True) | Q(first_used_at__gt=now), then=Value(now)),
            default=F("first_used_at"),
        ),
        last_used_at=Case(When(latest, then=Value(now)), default=F("last_used_at")),
        request_count=F("request_count") + 1,
        success_count=F("success_count") + int(not failed),
        error_count=F("error_count") + int(failed),
        rest_request_count=F("rest_request_count") + int(transport == "REST"),
        mcp_request_count=F("mcp_request_count") + int(transport == "MCP"),
        last_transport=Case(When(latest, then=Value(transport)), default=F("last_transport")),
        last_outcome=Case(When(latest, then=Value(outcome)), default=F("last_outcome")),
        last_status_code=Case(
            When(latest, then=Value(status_code)),
            default=F("last_status_code"),
            output_field=AccessToken._meta.get_field("last_status_code"),
        ),
    )


class TokenActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        token_id = getattr(request, "api_token_activity_id", None)
        if token_id is None:
            return response
        transport = "MCP" if request.path == "/mcp/" else "REST"
        failed = response.status_code >= 400
        # Inspect only protocol flags, never retain payloads, headers or error messages.
        data = getattr(response, "data", None)
        if transport == "MCP" and isinstance(data, dict):
            result = data.get("result")
            failed = (
                failed
                or "error" in data
                or (isinstance(result, dict) and result.get("isError") is True)
            )
        record_activity(
            token_id, transport=transport, status_code=response.status_code, failed=failed
        )
        return response
