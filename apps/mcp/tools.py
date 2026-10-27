from django.core.exceptions import ValidationError as ModelValidationError
from django.http import Http404
from rest_framework.exceptions import APIException

from apps.actions.authoring import get_tests, promote_run, save_action, save_tests, selected_version
from apps.actions.models import Action, Plugin
from apps.actions.serializers import (
    ActionSerializer,
    PromoteRequest,
    RunTestsRequest,
    SaveActionRequest,
    TestsRequest,
    TestSuiteSerializer,
    ValidateCodeRequest,
    VersionSerializer,
)
from apps.agents.models import Agent
from apps.agents.sdk import project_sdk
from apps.api_access.models import AccessToken
from apps.api_access.policy import authorize_tool, permitted_queryset
from apps.documents.models import Document
from apps.documents.serializers import DocumentSerializer
from apps.runs.authoring import run_tests, validate_code
from apps.runs.models import Approval, Run
from apps.runs.serializers import ApprovalSerializer, RunRequest, RunSerializer
from apps.runs.services import cancel_run, request_run, run_events

TOOL_ERRORS = (
    Http404,
    APIException,
    ModelValidationError,
    ValueError,
    Agent.DoesNotExist,
    Action.MultipleObjectsReturned,
    Run.DoesNotExist,
)

MOCK_SCHEMA = {
    "type": "object",
    "properties": {
        "tool": {
            "type": "string",
            "maxLength": 201,
            "pattern": r"^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$",
        },
        "args": {"type": "array", "maxItems": 30},
        "result": {},
        "error": {"type": "string", "maxLength": 2000},
        "times": {"type": "integer", "minimum": 1, "maximum": 100},
    },
    "required": ["tool", "args"],
    "oneOf": [{"required": ["result"]}, {"required": ["error"]}],
    "additionalProperties": False,
}
CASE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 200},
        "inputs": {"type": "object"},
        "expected": {},
        "mocks": {"type": "array", "maxItems": 100, "items": MOCK_SCHEMA},
        "forbidden_calls": {
            "type": "array",
            "maxItems": 100,
            "items": MOCK_SCHEMA["properties"]["tool"],
        },
    },
    "required": ["name", "inputs", "expected"],
    "additionalProperties": False,
}

TOOLS = [
    (
        "list_projects",
        "List permitted projects and runner availability.",
        {
            "offset": {"type": "integer", "minimum": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        [],
        False,
    ),
    (
        "get_project_sdk",
        "Discover the static execution SDK without credentials.",
        {"project": {"type": "string", "format": "uuid"}, "namespace": {"type": "string"}},
        ["project"],
        False,
    ),
    (
        "execute_code",
        "Accept a durable one-off program (source and inputs each at most 200000 UTF-8 bytes).",
        {
            "project": {"type": "string", "format": "uuid"},
            "source": {"type": "string", "minLength": 1},
            "inputs": {"type": "object"},
            "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 200},
        },
        ["project", "source", "idempotency_key"],
        True,
    ),
    (
        "get_run_events",
        "Poll ordered run events using an after-sequence cursor.",
        {
            "id": {"type": "string", "format": "uuid"},
            "after": {"type": "integer", "minimum": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        ["id"],
        False,
    ),
    (
        "cancel_run",
        "Request cancellation of an authorized run.",
        {"id": {"type": "string", "format": "uuid"}},
        ["id"],
        True,
    ),
    (
        "list_actions",
        "List permitted saved actions (at most 100 per page).",
        {
            "project": {"type": "string", "format": "uuid"},
            "offset": {"type": "integer", "minimum": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        [],
        False,
    ),
    (
        "get_action",
        "Read one explicit immutable action version.",
        {
            "action": {"type": "string", "format": "uuid"},
            "version": {"type": "integer", "minimum": 1},
        },
        ["action", "version"],
        False,
    ),
    (
        "validate_code",
        "Queue isolated semantic TypeScript validation without executing source.",
        {
            "project": {"type": "string", "format": "uuid"},
            "source": {"type": "string", "minLength": 1},
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 200},
        },
        ["project", "source", "idempotency_key"],
        True,
    ),
    (
        "promote_run",
        "Save the exact source of an authorized one-off run as an immutable draft.",
        {
            "id": {"type": "string", "format": "uuid"},
            "name": {"type": "string", "minLength": 1, "maxLength": 100},
            "action": {"type": "string", "format": "uuid"},
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
        },
        ["id", "name", "input_schema", "output_schema"],
        True,
    ),
    (
        "save_tests",
        "Save a new immutable mocked-test suite for an explicit action version.",
        {
            "action": {"type": "string", "format": "uuid"},
            "version": {"type": "integer", "minimum": 1},
            "cases": {"type": "array", "minItems": 1, "maxItems": 50, "items": CASE_SCHEMA},
        },
        ["action", "version", "cases"],
        True,
    ),
    (
        "get_tests",
        "Read a permitted action test suite; omit suite_revision to inspect latest.",
        {
            "action": {"type": "string", "format": "uuid"},
            "version": {"type": "integer", "minimum": 1},
            "suite_revision": {"type": "integer", "minimum": 1},
        },
        ["action", "version"],
        False,
    ),
    (
        "run_tests",
        "Queue an explicit saved suite in an isolated container with mocked integrations.",
        {
            "action": {"type": "string", "format": "uuid"},
            "version": {"type": "integer", "minimum": 1},
            "suite_revision": {"type": "integer", "minimum": 1},
            "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 200},
        },
        ["action", "version", "suite_revision", "idempotency_key"],
        True,
    ),
    (
        "save_action",
        "Save a new immutable action version.",
        {
            "project": {"type": "string", "format": "uuid"},
            "agent": {"type": "string", "format": "uuid", "description": "Legacy project alias"},
            "name": {"type": "string"},
            "source": {"type": "string"},
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "action": {"type": "string", "format": "uuid"},
        },
        ["name", "source"],
        True,
    ),
    (
        "run_action",
        "Queue a saved action; returns a run ID.",
        {
            "project": {"type": "string", "format": "uuid"},
            "agent": {"type": "string", "description": "Legacy project alias"},
            "action": {"type": "string"},
            "version": {"type": "integer", "minimum": 1},
            "inputs": {"type": "object"},
            "idempotency_key": {"type": "string"},
        },
        ["action", "version", "idempotency_key"],
        True,
    ),
    ("get_run", "Read run output and state.", {"id": {"type": "string"}}, ["id"], False),
    ("list_approvals", "Read pending human approvals. Clients cannot approve them.", {}, [], False),
    ("list_plugins", "Read installed plugin capability metadata.", {}, [], False),
    ("list_documents", "Read workspace memories and documents.", {}, [], False),
]


def schema(tool):
    name, description, properties, required, _ = tool
    return {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


def dispatch(request, name, args):
    authorize_tool(request.auth, name)
    workspace = request.workspace
    if name == "list_projects":
        projects = permitted_queryset(
            request.auth, Agent.objects.filter(workspace=workspace)
        ).order_by("pk")
        rows = []
        for project in projects[
            args.get("offset", 0) : args.get("offset", 0) + args.get("limit", 100)
        ]:
            executor = getattr(project, "executor", None)
            rows.append(
                {
                    "id": str(project.pk),
                    "name": project.name,
                    "enabled": project.enabled,
                    "runner": {
                        "registered": executor is not None,
                        "enabled": bool(executor and executor.enabled),
                        "protocol_version": executor.protocol_version if executor else None,
                        "last_seen_at": executor.last_seen_at if executor else None,
                    },
                }
            )
        next_offset = args.get("offset", 0) + len(rows)
        return {
            "projects": rows,
            "next_offset": next_offset if next_offset < projects.count() else None,
        }
    if name == "get_project_sdk":
        project = permitted_queryset(request.auth, Agent.objects.filter(workspace=workspace)).get(
            pk=args["project"]
        )
        return project_sdk(project, token=request.auth, namespace=args.get("namespace"))
    if name in {"get_run_events", "cancel_run"}:
        run = permitted_queryset(request.auth, Run.objects.filter(workspace=workspace)).get(
            pk=args["id"]
        )
        if name == "get_run_events":
            return run_events(run, after=args.get("after", 0), limit=args.get("limit", 100))
        return RunSerializer(cancel_run(workspace=workspace, actor=request.user, run=run)).data
    if name == "execute_code":
        data = RunRequest(
            data={
                "agent": args["project"],
                "operation": "code",
                "source": args["source"],
                "inputs": args.get("inputs", {}),
                "idempotency_key": args["idempotency_key"],
            }
        )
        data.is_valid(raise_exception=True)
        run = request_run(
            workspace=workspace,
            actor=request.user,
            data=data.validated_data,
            client_token=request.auth if isinstance(request.auth, AccessToken) else None,
        )
        return {
            "id": str(run.pk),
            "status": run.status,
            "source_digest": run.snapshot["source_digest"],
        }
    if name == "list_actions":
        actions = permitted_queryset(request.auth, Action.objects.filter(workspace=workspace))
        if "project" in args:
            actions = actions.filter(agent_id=args["project"])
        return ActionSerializer(
            actions.order_by("pk")[
                args.get("offset", 0) : args.get("offset", 0) + args.get("limit", 100)
            ],
            many=True,
        ).data
    if name == "get_action":
        version = selected_version(
            workspace=workspace,
            token=request.auth,
            action_id=args["action"],
            number=args["version"],
        )
        return {
            "action": ActionSerializer(version.action).data,
            "version": VersionSerializer(version).data,
        }
    if name == "validate_code":
        data = ValidateCodeRequest(data=args)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        run = validate_code(
            workspace=workspace,
            actor=request.user,
            token=request.auth,
            project_id=values.pop("project"),
            key=values.pop("idempotency_key"),
            **values,
        )
        return RunSerializer(run).data
    if name in {"save_tests", "get_tests", "run_tests"}:
        if name == "get_tests":
            suite = get_tests(
                workspace=workspace,
                token=request.auth,
                action_id=args["action"],
                number=args["version"],
                revision=args.get("suite_revision"),
            )
            return TestSuiteSerializer(suite).data
        data = (TestsRequest if name == "save_tests" else RunTestsRequest)(data=args)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        common = {
            "workspace": workspace,
            "actor": request.user,
            "token": request.auth,
            "action_id": args["action"],
            "number": values.pop("version"),
        }
        if name == "save_tests":
            return TestSuiteSerializer(save_tests(**common, **values)).data
        return RunSerializer(run_tests(**common, key=values.pop("idempotency_key"), **values)).data
    if name == "promote_run":
        data = PromoteRequest(data=args)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        if "action" in values:
            values["action_id"] = values.pop("action")
        run = permitted_queryset(request.auth, Run.objects.filter(workspace=workspace)).get(
            pk=args["id"]
        )
        obj, version = promote_run(
            workspace=workspace, actor=request.user, token=request.auth, run=run, **values
        )
        return {"action": str(obj.pk), "version": VersionSerializer(version).data}
    if name == "save_action":
        data = SaveActionRequest(data=args)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        agent = permitted_queryset(
            request.auth, Agent.objects.filter(workspace=workspace), authoring=True
        ).get(pk=values.pop("agent"))
        if "action" in values:
            values["action_id"] = values.pop("action")
        obj, version = save_action(
            workspace=workspace, actor=request.user, token=request.auth, agent=agent, **values
        )
        return {"action": str(obj.pk), "version": VersionSerializer(version).data}
    if name == "run_action":
        payload = {
            key: args[key]
            for key in ("project", "agent", "idempotency_key", "version")
            if key in args
        }
        payload.update(operation="action", action=args["action"], inputs=args.get("inputs", {}))
        data = RunRequest(data=payload)
        data.is_valid(raise_exception=True)
        return RunSerializer(
            request_run(
                workspace=workspace,
                actor=request.user,
                data=data.validated_data,
                client_token=request.auth if isinstance(request.auth, AccessToken) else None,
            )
        ).data
    if name == "get_run":
        return RunSerializer(
            permitted_queryset(request.auth, Run.objects.filter(workspace=workspace)).get(
                pk=args["id"]
            )
        ).data
    if name == "list_approvals":
        return ApprovalSerializer(
            Approval.objects.filter(workspace=workspace, status="pending"), many=True
        ).data
    if name == "list_plugins":
        return list(
            Plugin.objects.filter(workspace=workspace).values(
                "slug", "version", "description", "enabled"
            )
        )
    return DocumentSerializer(Document.objects.filter(workspace=workspace), many=True).data
