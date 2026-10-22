"""Durable isolated validation and test jobs, without production capabilities."""

from django.shortcuts import get_object_or_404

from apps.actions.authoring import (
    authorize_authoring,
    get_tests,
    selected_version,
    validate_schema,
)
from apps.agents.models import Agent

from .services import create_run


def validate_code(
    *, workspace, actor, token, project_id, source, key, input_schema=None, output_schema=None
):
    project = get_object_or_404(Agent, workspace=workspace, pk=project_id)
    authorize_authoring(token, project)
    return create_run(
        workspace=workspace,
        actor=actor,
        agent=project,
        operation="validate",
        inputs={},
        source=source,
        key=key,
        client_token=token,
        input_schema=validate_schema(input_schema if input_schema is not None else {}),
        output_schema=validate_schema(output_schema if output_schema is not None else {}),
    )


def run_tests(*, workspace, actor, token, action_id, number, suite_revision, key):
    version = selected_version(workspace=workspace, token=token, action_id=action_id, number=number)
    suite = get_tests(
        workspace=workspace,
        token=token,
        action_id=action_id,
        number=number,
        revision=suite_revision,
    )
    return create_run(
        workspace=workspace,
        actor=actor,
        agent=version.action.agent,
        operation="test",
        inputs={},
        key=key,
        version=version,
        client_token=token,
        test_suite={
            "id": str(suite.pk),
            "revision": suite.number,
            "digest": suite.digest,
            "cases": suite.cases,
        },
    )
