import json
from urllib.parse import urlsplit

from django.conf import settings
from drf_spectacular.utils import extend_schema
from jsonschema import Draft202012Validator
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.utils.encoders import JSONEncoder
from rest_framework.views import APIView

from apps.api_access.models import AccessToken
from apps.api_access.policy import authorize_tool, is_scoped
from apps.workspaces.services import active_membership

from .tools import TOOL_ERRORS, TOOLS, dispatch, schema

SUPPORTED_VERSIONS = ("2025-03-26",)


def visible_tool(token, tool):
    try:
        authorize_tool(token, tool[0])
    except PermissionDenied:
        return False
    return True


class MCPView(APIView):
    def initial(self, request, *args, **kwargs):
        origin = request.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
            except ValueError as error:
                raise PermissionDenied("Origin is not allowed.") from error
            same_origin = origin == f"{request.scheme}://{request.get_host()}"
            trusted = origin in getattr(settings, "CSRF_TRUSTED_ORIGINS", [])
            if not parsed.scheme or not parsed.netloc or not (same_origin or trusted):
                raise PermissionDenied("Origin is not allowed.")
        super().initial(request, *args, **kwargs)

    @extend_schema(request=dict, responses=dict)
    def post(self, request):
        active_membership(request)
        version = request.headers.get("MCP-Protocol-Version")
        if version and version not in SUPPORTED_VERSIONS:
            return Response({"error": "Unsupported MCP protocol version."}, status=400)
        if request.content_type.split(";", 1)[0] != "application/json":
            return Response({"error": "Content-Type must be application/json."}, status=415)
        accept = request.headers.get("Accept", "*/*")
        if "application/json" not in accept and "*/*" not in accept:
            return Response({"error": "Accept must include application/json."}, status=406)
        body = request.data
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
            return Response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "Invalid request"},
                },
                status=400,
            )
        if not isinstance(body.get("method"), str) or (
            "id" in body and (isinstance(body["id"], (dict, list, bool)) or body["id"] is None)
        ):
            return Response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "Invalid request"},
                },
                status=400,
            )
        request_id = body.get("id")
        method = body.get("method")
        params = body.get("params", {})
        if not isinstance(params, dict):
            return Response(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32602, "message": "Parameters must be an object"},
                }
            )
        if "id" not in body or method == "notifications/initialized":
            return Response(status=202)
        if method == "initialize":
            value = {
                "protocolVersion": params.get("protocolVersion")
                if params.get("protocolVersion") in SUPPORTED_VERSIONS
                else SUPPORTED_VERSIONS[0],
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "OrgSDK", "version": "1.0.0"},
            }
        elif method == "ping":
            value = {}
        elif method == "tools/list":
            value = {"tools": [schema(tool) for tool in TOOLS if visible_tool(request.auth, tool)]}
        elif method == "tools/call":
            tool = next((t for t in TOOLS if t[0] == params.get("name")), None)
            if not tool:
                return Response(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32602, "message": "Unknown tool"},
                    }
                )
            args = params.get("arguments", {})
            errors = list(Draft202012Validator(schema(tool)["inputSchema"]).iter_errors(args))
            if errors:
                return Response(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {
                            "code": -32602,
                            "message": "Invalid tool arguments. Check fields, types and limits.",
                        },
                    }
                )
            if (
                tool[4]
                and isinstance(request.auth, AccessToken)
                and not is_scoped(request.auth)
                and "write" not in request.auth.scopes
            ):
                raise PermissionDenied("Write scope required.")
            try:
                output = dispatch(request, tool[0], args)
                value = {
                    "content": [{"type": "text", "text": json.dumps(output, cls=JSONEncoder)}],
                    "isError": False,
                }
            except TOOL_ERRORS as error:
                value = {
                    "content": [{"type": "text", "text": tool_error(error)}],
                    "isError": True,
                }
        else:
            return Response(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "Method not found"},
                }
            )
        return Response({"jsonrpc": "2.0", "id": request_id, "result": value})


def tool_error(error):
    # Validation libraries can interpolate arbitrary submitted values, including secrets.
    if isinstance(error, PermissionDenied):
        return "Permission denied. Check client scopes and project grants."
    detail = getattr(error, "detail", None)
    if (
        isinstance(detail, list)
        and detail
        and str(detail[0])
        in {
            "Idempotency key already used for a different request.",
            "Source must be nonblank and at most 200000 UTF-8 bytes.",
            "Inputs must be an object under 200KB.",
            "Workspace or agent is disabled.",
        }
    ):
        return str(detail[0])
    return "Request rejected. Check resource IDs, input fields and published execution limits."
