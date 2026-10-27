import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.actions.services import resolve_version, source_digest, validate_inputs
from apps.agents.models import Agent
from apps.agents.sdk import SDK_REVISION, configuration_revision, project_sdk
from apps.agents.services import agent_snapshot
from apps.api_access.policy import authorize_run, is_scoped
from apps.audit.services import audit
from apps.credentials.services import redact, redact_stream_snapshot
from apps.execution.models import WorkspaceSettings
from apps.workspaces.models import Membership, Workspace

from .models import Approval, Run, RunEvent
from .validation import validate_run_inputs, validate_source

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


def request_run(*, workspace, actor, data, client_token=None):
    if data["operation"] in {"validate", "test"}:
        from .authoring import run_tests, validate_code

        shared = {
            "workspace": workspace,
            "actor": actor,
            "token": client_token,
            "key": data["idempotency_key"],
        }
        if data["operation"] == "validate":
            return validate_code(
                **shared,
                project_id=data["agent"],
                source=data["source"],
                input_schema=data.get("input_schema"),
                output_schema=data.get("output_schema"),
            )
        selected_action = get_object_or_404(
            Agent.objects.filter(workspace=workspace),
            pk=data["agent"],
        )
        from apps.actions.models import Action

        if not Action.objects.filter(
            pk=data["action"], agent=selected_action, workspace=workspace
        ).exists():
            raise ValidationError("Action does not belong to the selected project.")
        return run_tests(
            **shared,
            action_id=data["action"],
            number=data["version"],
            suite_revision=data["suite_revision"],
        )
    agent = get_object_or_404(Agent, workspace=workspace, pk=data["agent"])
    version = None
    if data["operation"] == "action":
        version = resolve_version(
            workspace=workspace,
            agent=agent,
            action_id=data.get("action"),
            number=data.get("version"),
        )
    authorize_run(
        client_token,
        agent=agent,
        operation=data["operation"],
        version=version,
        explicit_version=data.get("version") is not None,
    )
    return create_run(
        workspace=workspace,
        actor=actor,
        agent=agent,
        operation=data["operation"],
        inputs=data["inputs"],
        key=data["idempotency_key"],
        version=version,
        conversation_id=data.get("conversation"),
        client_token=client_token,
        source=data.get("source"),
    )


@transaction.atomic
def create_run(
    *,
    workspace,
    actor,
    agent,
    operation,
    inputs,
    key,
    version=None,
    retry_of=None,
    conversation_id=None,
    client_token=None,
    source=None,
    input_schema=None,
    output_schema=None,
    test_suite=None,
    origin=None,
    origin_reference="",
):
    if operation == "chat":
        raise ValidationError(
            "Built-in chat is retired; use an external client to execute code or actions."
        )
    Workspace.objects.get(pk=workspace.pk)
    if not Membership.objects.filter(workspace=workspace, user=actor).exists():
        raise PermissionDenied("Membership revoked.")
    authorize_run(client_token, agent=agent, operation=operation, version=version)
    if retry_of and operation in {"validate", "test"}:
        source = retry_of.snapshot.get("source")
        input_schema = retry_of.snapshot.get("input_schema", {})
        output_schema = retry_of.snapshot.get("output_schema", {})
        test_suite = retry_of.snapshot.get("test_suite")
    if operation in {"code", "validate"}:
        source = retry_of.snapshot.get("source") if retry_of else source
        validate_source(source)
        if version or conversation_id:
            raise ValidationError("Code runs cannot select a version or conversation.")
    validate_run_inputs(inputs)
    namespace = str(client_token.pk) if is_scoped(client_token) else ""
    existing = Run.objects.filter(
        workspace=workspace, idempotency_namespace=namespace, idempotency_key=key
    ).first()
    if existing:
        if (
            existing.agent_id != agent.pk
            or existing.operation != operation
            or existing.inputs != inputs
            or existing.actor_id != actor.pk
            or existing.retry_of_id != (retry_of.pk if retry_of else None)
            or existing.conversation_id != conversation_id
            or existing.action_version_id != (version.pk if version else None)
            or (operation in {"code", "validate"} and existing.snapshot.get("source") != source)
            or (
                operation == "validate"
                and (
                    existing.snapshot.get("input_schema", {}) != (input_schema or {})
                    or existing.snapshot.get("output_schema", {}) != (output_schema or {})
                )
            )
            or (operation == "test" and existing.snapshot.get("test_suite") != test_suite)
        ):
            raise ValidationError("Idempotency key already used for a different request.")
        return existing
    config, _ = WorkspaceSettings.objects.get_or_create(workspace=workspace)
    if not config.enabled or not agent.enabled:
        raise PermissionDenied("Workspace or agent is disabled.")
    if agent.workspace_id != workspace.pk:
        raise PermissionDenied("Agent does not belong to this workspace.")
    if operation == "action":
        if not version or version.action.agent_id != agent.pk or not version.action.enabled:
            raise ValidationError("An enabled action belonging to this agent is required.")
        validate_inputs(version, inputs)
    elif operation in {"code", "validate"}:
        pass
    elif operation == "test":
        if not version or version.action.agent_id != agent.pk or not test_suite:
            raise ValidationError(
                "Tests require an explicit action version and test suite revision."
            )
    else:
        raise ValidationError("Unsupported operation.")
    if conversation_id:
        raise ValidationError("Conversations are archived and cannot accept new runs.")
    snapshot_agents = Agent.objects.filter(workspace=workspace, enabled=True, pk=agent.pk)
    agents = [agent_snapshot(a) for a in snapshot_agents]
    selected = next(a for a in agents if a["id"] == str(agent.pk))
    snapshot = {
        "agents": agents,
        "root_agent_id": str(agent.pk),
        "sdk_revision": SDK_REVISION,
        "configuration_revision": configuration_revision(selected),
    }
    if operation in {"action", "code", "validate", "test"}:
        for selected in agents:
            selected.update(instructions="", model="", credential_id=None)
    if operation == "code":
        snapshot.update(source=source, source_digest=source_digest(source), protocol_version=2)
    if operation in {"action", "code", "validate", "test"}:
        snapshot["sdk"] = project_sdk(agent)
    if operation in {"validate", "test"}:
        snapshot.update(
            source=source if operation == "validate" else version.source,
            protocol_version=3,
            validation_mode="semantic",
            input_schema=input_schema or (version.input_schema if version else {}),
            output_schema=output_schema or (version.output_schema if version else {}),
        )
        snapshot["source_digest"] = source_digest(snapshot["source"])
        for selected in agents:
            selected.update(
                instructions="",
                model="",
                credential_id=None,
                plugins=[],
                resources={
                    "tables": {"read": [], "write": []},
                    "documents": {"read": [], "write": []},
                },
            )
        if test_suite:
            snapshot["test_suite"] = test_suite
    if version:
        snapshot["source"] = version.source
        snapshot["source_digest"] = source_digest(version.source)
        snapshot["version"] = version.number
        snapshot["validation_mode"] = version.validation_mode
        snapshot["output_schema"] = version.output_schema
        snapshot["input_schema"] = version.input_schema
        if operation == "test":
            snapshot["validation_mode"] = "semantic"
    if retry_of:
        snapshot = retry_of.snapshot
        if is_scoped(client_token):
            snapshot = {
                **snapshot,
                "agents": [a for a in snapshot["agents"] if a["id"] == str(agent.pk)],
            }
    run = Run.objects.create(
        workspace=workspace,
        actor=actor,
        agent=agent,
        operation=operation,
        inputs=inputs,
        idempotency_key=key,
        idempotency_namespace=namespace,
        client_token=client_token,
        action_version=version,
        retry_of=retry_of,
        conversation=None,
        snapshot=snapshot,
        origin="retry" if retry_of else (origin or ("client" if client_token else "browser")),
        origin_reference=(
            str(retry_of.pk)
            if retry_of
            else str(client_token.pk)
            if client_token
            else origin_reference
        ),
    )
    audit(workspace, actor, "run.created", run)
    return run


def append_event(run, values):
    """Persist a validated event while the caller holds the live run lock."""
    if values["kind"] == "chat.snapshot":
        data = values["data"]
        if (
            not isinstance(data, dict)
            or set(data) != {"agent_id", "round", "content"}
            or data["agent_id"] != str(run.agent_id)
            or type(data["round"]) is not int
            or not 0 <= data["round"] < 20
            or not isinstance(data["content"], str)
            or len(data["content"]) > 60_000
        ):
            raise ValidationError("Invalid chat snapshot.")
        if (
            run.events.filter(kind="chat.snapshot").exclude(sequence=values["sequence"]).count()
            >= 240
        ):
            raise ValidationError("Chat snapshot limit reached.")
        values["data"] = {**data, "content": redact_stream_snapshot(run, data["content"])}
    else:
        values["data"] = redact(run, values["data"])
    event, created = RunEvent.objects.get_or_create(
        run=run,
        sequence=values["sequence"],
        defaults={"kind": values["kind"], "data": values["data"]},
    )
    if not created and (event.kind != values["kind"] or event.data != values["data"]):
        raise ValidationError("Event sequence already contains different data.")


def complete_run(run, values):
    """Apply a validated completion while the caller holds the run lock."""
    if (
        run.operation == "action"
        and values["status"] == "succeeded"
        and run.snapshot.get("output_schema")
    ):
        if not isinstance(values["output"], dict) or "result" not in values["output"]:
            raise ValidationError(
                {"output": "Action completion requires a result matching its output contract."}
            )
        from apps.actions.authoring import validate_contract

        validate_contract(
            run.snapshot.get("output_schema", {}), values["output"].get("result"), "output"
        )
    values = redact(run, values)
    if run.status in TERMINAL:
        if (run.status, run.output, run.error) != (
            values["status"],
            values["output"],
            values["error"],
        ):
            raise ValidationError("Run already completed with a different result.")
        return run
    if run.approvals.filter(status="pending").exists():
        if values["status"] == "succeeded" and not run.cancel_requested:
            raise ValidationError("Resolve pending approvals before completing.")
        run.approvals.filter(status="pending").update(status="interrupted")
    cancel_descendants(run)
    run.status = "cancelled" if run.cancel_requested else values["status"]
    run.output, run.error = values["output"], values["error"]
    run.save(update_fields=["status", "output", "error", "updated_at"])
    audit(run.workspace, run.actor, f"run.{run.status}", run)
    return run


def interrupt_run(run):
    """Finish an expired execution while the caller holds the run lock."""
    cancel_descendants(run)
    run.status = "cancelled" if run.cancel_requested else "interrupted"
    run.error = "Execution stopped responding. Review side effects before explicitly retrying."
    run.capability_hash = ""
    run.save(update_fields=["status", "error", "capability_hash", "updated_at"])
    run.approvals.filter(status="pending").update(status="interrupted")
    audit(run.workspace, run.actor, f"run.{run.status}", run)


@transaction.atomic
def create_approval(*, workspace, actor, run, prompt):
    """Request approval after the caller authorizes workspace/run access."""
    Workspace.objects.get(pk=workspace.pk)
    run = Run.objects.get(pk=run.pk, workspace=workspace)
    if run.status not in {"running", "waiting_approval"}:
        raise ValidationError("Approval requires a live run.")
    approval = Approval.objects.create(workspace=workspace, run=run, prompt=prompt)
    audit(workspace, actor, "approval.created", approval)
    run.status = "waiting_approval"
    run.save(update_fields=["status"])
    return approval


@transaction.atomic
def decide_approval(*, workspace, actor, approval, decision):
    """Record a human decision after the caller authorizes manager/token scope."""
    Workspace.objects.get(pk=workspace.pk)
    run = Run.objects.get(pk=approval.run_id, workspace=workspace)
    approval = Approval.objects.get(pk=approval.pk, workspace=workspace)
    if approval.status != "pending" or run.status in TERMINAL:
        raise ValidationError("Approval is no longer actionable.")
    approval.status = decision
    approval.decided_by = actor
    approval.save()
    audit(workspace, actor, "approval.decided", approval)
    return approval


def delegate_run(parent, *, agent_id, message, idempotency_key):
    raise ValidationError("Reasoning delegation is unsupported; use an external agent harness.")


def cancel_descendants(run):
    for child in run.children.exclude(status__in=TERMINAL):
        child.cancel_requested = True
        child.status = "cancelled"
        child.capability_hash = ""
        child.save(update_fields=["cancel_requested", "status", "capability_hash"])
        child.approvals.filter(status="pending").update(status="interrupted")
        cancel_descendants(child)


def conversation_context(conversation):
    """Keep complete successful pairs within a bounded context budget."""
    pairs = []
    size = 0
    for turn in conversation.turns.filter(status="succeeded").order_by("-created_at", "-pk")[:20]:
        answer = turn.output if isinstance(turn.output, str) else json.dumps(turn.output)
        pair = [
            {"role": "user", "content": turn.inputs["message"]},
            {"role": "assistant", "content": answer},
        ]
        pair_size = sum(len(message["content"]) for message in pair)
        if size + pair_size > 60_000:
            break
        pairs.append(pair)
        size += pair_size
    return [message for pair in reversed(pairs) for message in pair]


@transaction.atomic
def cancel_run(*, workspace, actor, run):
    Workspace.objects.get(pk=workspace.pk)
    if not Membership.objects.filter(workspace=workspace, user=actor).exists():
        raise PermissionDenied("Membership revoked.")
    run = Run.objects.get(pk=run.pk, workspace=workspace)
    if run.status not in TERMINAL:
        cancel_descendants(run)
        run.cancel_requested = True
        if run.status == "queued":
            run.status = "cancelled"
        run.save(update_fields=["cancel_requested", "status", "updated_at"])
        audit(workspace, actor, "run.cancel_requested", run)
    return run


def run_events(run, *, after=0, limit=100):
    if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise ValidationError("Event cursor must be nonnegative and limit between 1 and 100.")
    rows = list(
        run.events.filter(sequence__gt=after).values("sequence", "kind", "data", "created_at")[
            :limit
        ]
    )
    return {"events": rows, "next_cursor": rows[-1]["sequence"] if rows else after}
