"""Action versions, validation and plugin snapshots shared by product transports."""

import hashlib

from django.db import transaction
from django.shortcuts import get_object_or_404
from jsonschema import Draft202012Validator
from rest_framework.exceptions import ValidationError

from .models import Action, ActionVersion


def resolve_version(*, workspace, agent, action_id, number=None):
    action = get_object_or_404(Action, workspace=workspace, pk=action_id, agent=agent)
    versions = action.versions.order_by("-number")
    return versions.filter(number=number).first() if number is not None else versions.first()


def validate_inputs(version, inputs):
    errors = list(Draft202012Validator(version.input_schema).iter_errors(inputs))
    if errors:
        raise ValidationError({"inputs": errors[0].message})


@transaction.atomic
def save_version(
    action, source, input_schema, output_schema=None, *, sdk_contract=None, promoted_from=None
):
    Action.objects.select_for_update().get(pk=action.pk)
    from apps.runs.validation import validate_source

    from .authoring import validate_schema

    validate_source(source)
    input_schema = validate_schema(input_schema)
    output_schema = validate_schema(output_schema if output_schema is not None else {})
    sdk_contract = sdk_contract or {}
    latest = action.versions.order_by("-number").first()
    if (
        latest
        and latest.source == source
        and latest.input_schema == input_schema
        and latest.output_schema == output_schema
        and latest.sdk_contract == sdk_contract
        and latest.promoted_from_id == (promoted_from.pk if promoted_from else None)
        and latest.validation_mode == "semantic"
    ):
        return latest
    return ActionVersion.objects.create(
        action=action,
        source=source,
        input_schema=input_schema,
        output_schema=output_schema,
        validation_mode="semantic",
        sdk_contract=sdk_contract,
        promoted_from=promoted_from,
        number=latest.number + 1 if latest else 1,
    )


def source_digest(source):
    return hashlib.sha256(source.encode()).hexdigest()


def plugin_snapshot(plugin):
    snapshot = {key: getattr(plugin, key) for key in ["slug", "version", "source", "digest"]} | {
        "credential_id": str(plugin.credential_id) if plugin.credential_id else None,
        "credential_provider": plugin.release_metadata.get("auth", {}).get("provider")
        or (plugin.credential.provider if plugin.credential_id else None),
    }
    snapshot.update(
        distribution=plugin.distribution,
        configuration=plugin.configuration,
        package_url=plugin.package_url,
        contract_version=1,
    )
    return snapshot
