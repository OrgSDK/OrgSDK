"""Agent snapshot assembly for immutable execution requests."""

from apps.actions.services import plugin_snapshot


def agent_snapshot(agent):
    plugins = [plugin_snapshot(p) for p in agent.plugins.filter(enabled=True)]
    return {
        "id": str(agent.pk),
        "name": agent.name,
        "instructions": agent.instructions,
        "model": agent.model,
        "credential_id": str(agent.credential_id) if agent.credential_id else None,
        "plugins": plugins,
        "resources": {
            kind: {
                mode: [
                    str(pk)
                    for pk in getattr(agent, field + "_" + kind)
                    .filter(workspace=agent.workspace)
                    .order_by("pk")
                    .values_list("pk", flat=True)
                ]
                for mode, field in [("read", "readable"), ("write", "writable")]
            }
            for kind in ["tables", "documents"]
        },
        # Keep the executor snapshot shape; shared documents are accessed through tools.
        "documents": [],
    }


def create_agent(*, workspace, **values):
    from django.db import transaction

    from apps.execution.services import ensure_local_executor
    from apps.workspaces.models import Workspace

    from .models import Agent

    with transaction.atomic():
        Workspace.objects.get(pk=workspace.pk)
        grants = {
            key: values.pop(key)
            for key in list(values)
            if key.startswith(("readable_", "writable_"))
        }
        agent = Agent.objects.create(workspace=workspace, **values)
        for key, resources in grants.items():
            getattr(agent, key).set(resources)
        ensure_local_executor(agent)
        return agent
