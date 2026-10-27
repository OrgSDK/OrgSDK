"""Finite direct execution request limits shared by all transports."""

import json

from rest_framework.exceptions import ValidationError

SOURCE_UTF8_BYTES = 200_000
INPUTS_JSON_UTF8_BYTES = 200_000
RESULT_JSON_BYTES = 1_000_000


def validate_source(source):
    try:
        valid = (
            isinstance(source, str)
            and source.strip()
            and "\x00" not in source
            and len(source.encode("utf-8")) <= SOURCE_UTF8_BYTES
        )
    except UnicodeEncodeError:
        valid = False
    if not valid:
        raise ValidationError("Source must be nonblank UTF-8 text under 200KB, without NUL.")
    return source


def validate_run_inputs(inputs):
    try:
        valid = (
            isinstance(inputs, dict)
            and nul_free(inputs)
            and len(json.dumps(inputs, ensure_ascii=False, allow_nan=False).encode("utf-8"))
            <= INPUTS_JSON_UTF8_BYTES
        )
    except UnicodeEncodeError, ValueError, TypeError, RecursionError:
        valid = False
    if not valid:
        raise ValidationError("Inputs must be an object under 200KB.")
    return inputs


def nul_free(value):
    if isinstance(value, str):
        return "\x00" not in value
    if isinstance(value, dict):
        return all(nul_free(key) and nul_free(item) for key, item in value.items())
    if isinstance(value, list):
        return all(nul_free(item) for item in value)
    return True
