"""Immutable action authoring contracts shared by REST and MCP."""

import hashlib
import json
import re

from django.db import transaction
from django.shortcuts import get_object_or_404
from jsonschema import Draft202012Validator, SchemaError
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.api_access.models import AccessToken
from apps.api_access.policy import is_scoped, permitted_queryset
from apps.audit.services import audit
from apps.tables.services import lock_actor

from .models import Action, ActionTestSuite, ActionVersion
from .services import save_version

MAX_BYTES = 200_000


def bounded_json(value):
    try:
        encoded = json.dumps(
            value, allow_nan=False, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        raise ValidationError("Use valid finite JSON.") from error
    if len(encoded) > MAX_BYTES:
        raise ValidationError("JSON exceeds the 200000-byte limit.")
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str) and "\x00" in item:
            raise ValidationError("JSON strings and keys cannot contain NUL characters.")
        if isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, (list, tuple)):
            pending.extend(item)
    return encoded


def validate_schema(schema):
    bounded_json(schema)
    if not isinstance(schema, dict):
        raise ValidationError("Use a JSON Schema object.")
    pending = [(schema, 0)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > 2000 or depth > 30:
            raise ValidationError("JSON Schema is too complex.")
        if isinstance(node, dict):
            for key in ("$ref", "$dynamicRef", "$recursiveRef"):
                if key in node:
                    raise ValidationError("Use inline JSON Schemas without reference keywords.")
            pending.extend(
                (value, depth + 1) for value in node.values() if isinstance(value, (dict, list))
            )
        elif isinstance(node, list):
            pending.extend((value, depth + 1) for value in node if isinstance(value, (dict, list)))
    try:
        Draft202012Validator.check_schema(schema)
    except (SchemaError, RecursionError) as error:
        raise ValidationError("Invalid JSON Schema.") from error
    return schema


def validate_contract(schema, value, label):
    # Historical schemas may contain references; new checks must never resolve them over a network.
    validate_schema(schema)
    try:
        error = next(Draft202012Validator(schema).iter_errors(value), None)
    except Exception as error:
        raise ValidationError({label: "JSON Schema could not be resolved safely."}) from error
    if error:
        raise ValidationError({label: error.message})


def authorize_authoring(token, project, *, allow_legacy=False):
    if not isinstance(token, AccessToken):
        return
    if (
        allow_legacy
        and not token.revoked
        and token.workspace_id == project.workspace_id
        and "write" in token.scopes
        and not is_scoped(token)
    ):
        return
    if (
        token.revoked
        or "actions:write" not in token.scopes
        or not token.projects.filter(pk=project.pk, workspace=project.workspace).exists()
    ):
        raise PermissionDenied("Action authoring requires actions:write and a project grant.")


def selected_version(*, workspace, token, action_id, number, authoring=False):
    if type(number) is not int or number < 1:
        raise ValidationError("Select an explicit positive integer version.")
    version = get_object_or_404(
        permitted_queryset(
            token, ActionVersion.objects.filter(action__workspace=workspace), authoring=authoring
        ),
        action_id=action_id,
        number=number,
    )
    if authoring:
        authorize_authoring(token, version.action.agent)
    return version


@transaction.atomic
def save_action(
    *,
    workspace,
    actor,
    token,
    agent,
    name,
    source,
    input_schema=None,
    output_schema=None,
    action_id=None,
    sdk_contract=None,
    promoted_from=None,
):
    lock_actor(workspace, actor)
    authorize_authoring(token, agent, allow_legacy=True)
    if agent.workspace_id != workspace.pk:
        raise PermissionDenied("Project is outside this workspace.")
    if action_id:
        action = get_object_or_404(Action, pk=action_id, agent=agent, workspace=workspace)
    else:
        matches = list(Action.objects.filter(agent=agent, workspace=workspace, name=name)[:2])
        if len(matches) > 1:
            raise ValidationError("Multiple actions have this name. Supply an exact action ID.")
        action = (
            matches[0]
            if matches
            else Action.objects.create(workspace=workspace, agent=agent, name=name)
        )
    version = save_version(
        action,
        source,
        input_schema if input_schema is not None else {},
        output_schema if output_schema is not None else {},
        sdk_contract=sdk_contract,
        promoted_from=promoted_from,
    )
    audit(workspace, actor, "action.version_saved", action)
    return action, version


def validate_cases(version, cases):
    bounded_json(cases)
    if not isinstance(cases, list) or not 1 <= len(cases) <= 50:
        raise ValidationError("Supply between 1 and 50 test cases.")
    normalized = []
    names = set()
    for case in cases:
        if (
            not isinstance(case, dict)
            or set(case) - {"name", "inputs", "expected", "mocks", "forbidden_calls"}
            or not {"name", "inputs", "expected"} <= case.keys()
        ):
            raise ValidationError("Cases need name, inputs and expected.")
        name = case["name"]
        if not isinstance(name, str) or not name.strip() or len(name) > 200 or name in names:
            raise ValidationError(
                "Test case names must be distinct nonempty strings (200 characters maximum)."
            )
        names.add(name)
        if not isinstance(case["inputs"], dict):
            raise ValidationError("Case inputs must be objects.")
        validate_contract(version.input_schema, case["inputs"], "inputs")
        validate_contract(version.output_schema, case["expected"], "expected")
        mocks = case.get("mocks", [])
        forbidden = case.get("forbidden_calls", [])
        if (
            not isinstance(mocks, list)
            or len(mocks) > 100
            or not isinstance(forbidden, list)
            or len(forbidden) > 100
        ):
            raise ValidationError("Use at most 100 mocks and forbidden calls per case.")

        def valid_tool(value):
            return (
                isinstance(value, str)
                and len(value) <= 201
                and re.fullmatch(r"[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?", value) is not None
            )

        if any(not valid_tool(tool) for tool in forbidden):
            raise ValidationError("Forbidden calls must be tool names.")
        clean_mocks = []
        for mock in mocks:
            if (
                not isinstance(mock, dict)
                or set(mock) - {"tool", "args", "result", "error", "times"}
                or not {"tool", "args"} <= mock.keys()
                or not valid_tool(mock["tool"])
                or not isinstance(mock["args"], list)
                or len(mock["args"]) > 30
            ):
                raise ValidationError("Mocks require a tool name and an args array.")
            if ("result" in mock) == ("error" in mock) or (
                "error" in mock and not isinstance(mock["error"], str)
            ):
                raise ValidationError("Mocks require exactly one result or error string.")
            times = mock.get("times", 1)
            if type(times) is not int or not 1 <= times <= 100:
                raise ValidationError("Mock times must be an integer between 1 and 100.")
            clean_mocks.append({**mock, "times": times})
        normalized.append({**case, "mocks": clean_mocks, "forbidden_calls": forbidden})
    bounded_json(normalized)
    return normalized


@transaction.atomic
def save_tests(*, workspace, actor, token, action_id, number, cases):
    lock_actor(workspace, actor)
    version = selected_version(
        workspace=workspace, token=token, action_id=action_id, number=number, authoring=True
    )
    cases = validate_cases(version, cases)
    digest = hashlib.sha256(bounded_json(cases)).hexdigest()
    latest = version.test_suites.order_by("-number").first()
    if latest and latest.digest == digest:
        return latest
    suite = ActionTestSuite.objects.create(
        version=version, number=latest.number + 1 if latest else 1, cases=cases, digest=digest
    )
    audit(workspace, actor, "action.tests_saved", version.action)
    return suite


def get_tests(*, workspace, token, action_id, number, revision=None):
    if revision is not None and (type(revision) is not int or revision < 1):
        raise ValidationError("Select an explicit positive integer suite revision.")
    version = selected_version(workspace=workspace, token=token, action_id=action_id, number=number)
    suites = version.test_suites.order_by("-number")
    if revision is not None:
        return get_object_or_404(suites, number=revision)
    suite = suites.first()
    if suite is None:
        from rest_framework.exceptions import NotFound

        raise NotFound("No test suite saved for this version.")
    return suite


@transaction.atomic
def promote_run(*, workspace, actor, token, run, name, input_schema, output_schema, action_id=None):
    from apps.runs.models import Run

    lock_actor(workspace, actor)
    run = get_object_or_404(
        permitted_queryset(token, Run.objects.filter(workspace=workspace)), pk=run.pk
    )
    if isinstance(token, AccessToken) and "runs:read" not in token.scopes:
        raise PermissionDenied("Promotion requires runs:read.")
    authorize_authoring(token, run.agent)
    if run.operation != "code":
        raise ValidationError("Only one-off code runs can be promoted.")
    return save_action(
        workspace=workspace,
        actor=actor,
        token=token,
        agent=run.agent,
        name=name,
        source=run.snapshot["source"],
        input_schema=input_schema,
        output_schema=output_schema,
        action_id=action_id,
        sdk_contract={
            key: run.snapshot.get(key)
            for key in ["sdk_revision", "configuration_revision", "sdk"]
            if key in run.snapshot
        },
        promoted_from=run,
    )
