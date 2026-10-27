from io import StringIO

import pytest
from django.core.management import call_command
from rest_framework.exceptions import ValidationError

from apps.runs.models import Approval, ChatFeedback, Conversation, Run
from apps.runs.services import create_run, delegate_run
from tests import test_project_api


@pytest.fixture
def project_context(request):
    return request.getfixturevalue("_project_context")


_project_context = test_project_api.project_context

pytestmark = pytest.mark.django_db


def historical_chat(workspace, project, user, **values):
    return Run.objects.create(
        workspace=workspace,
        agent=project,
        actor=user,
        operation="chat",
        inputs={"message": "old"},
        idempotency_key="old-chat",
        snapshot={"agents": [], "root_agent_id": str(project.pk)},
        **values,
    )


def test_chat_cannot_be_created_replayed_or_retried(project_context, user):
    client, workspace, project = project_context
    original = historical_chat(workspace, project, user, status="failed")
    with pytest.raises(ValidationError, match="retired"):
        create_run(
            workspace=workspace,
            agent=project,
            actor=user,
            operation="chat",
            inputs=original.inputs,
            key=original.idempotency_key,
        )
    response = client.post(f"/api/v1/runs/{original.pk}/retry/", {"idempotency_key": "new"})
    assert response.status_code == 400
    assert Run.objects.count() == 1
    with pytest.raises(ValidationError, match="unsupported"):
        delegate_run(original, agent_id=project.pk, message="new", idempotency_key="delegate")


def test_chat_history_and_private_feedback_are_read_only(project_context, user, django_user_model):
    client, workspace, project = project_context
    conversation = Conversation.objects.create(workspace=workspace, agent=project, title="Archived")
    original = historical_chat(
        workspace, project, user, conversation=conversation, status="succeeded"
    )
    ChatFeedback.objects.create(run=original, user=user, rating="positive", note="My private note")
    other = django_user_model.objects.create_user(username="other", email="other@example.test")
    ChatFeedback.objects.create(
        run=original, user=other, rating="negative", note="Other private note"
    )
    detail = client.get(f"/api/v1/conversations/{conversation.pk}/turns/")
    assert detail.status_code == 200 and len(detail.data) == 1
    feedback = client.get(f"/api/v1/runs/{original.pk}/feedback/")
    assert feedback.data["feedback"]["note"] == "My private note"
    assert "Other private note" not in str(feedback.data)
    assert (
        client.put(f"/api/v1/runs/{original.pk}/feedback/", {"rating": "negative"}).status_code
        == 405
    )
    assert client.delete(f"/api/v1/runs/{original.pk}/feedback/").status_code == 405
    assert client.post("/api/v1/conversations/", {"agent": str(project.pk)}).status_code == 405
    assert client.patch(f"/api/v1/agents/{project.pk}/", {"model": "new"}).status_code == 400
    project.refresh_from_db()
    assert project.model == "private-model"


def test_explicit_drain_revokes_capability_without_deleting_history(project_context, user):
    _, workspace, project = project_context
    original = historical_chat(
        workspace,
        project,
        user,
        status="running",
        capability_hash="a" * 64,
    )
    Approval.objects.create(workspace=workspace, run=original, prompt="Historical pending approval")
    output = StringIO()
    call_command("drain_chat_runs", stdout=output)
    original.refresh_from_db()
    assert original.status == "running"
    assert "requiring drain: 1" in output.getvalue()
    # An operator must also be able to drain work whose submitting member has left.
    workspace.memberships.all().delete()
    call_command("drain_chat_runs", apply=True, stdout=output)
    original.refresh_from_db()
    assert original.status == "cancelled" and original.cancel_requested
    assert original.capability_hash == ""
    assert original.approvals.get().status == "interrupted"
    assert original.inputs == {"message": "old"}
    call_command("drain_chat_runs", apply=True, stdout=output)
    assert Run.objects.count() == 1
