"""Safe, static discovery of the project execution contract."""

import hashlib
import json
import re

from rest_framework.exceptions import PermissionDenied

from apps.api_access.models import AccessToken
from apps.runs.validation import INPUTS_JSON_UTF8_BYTES, RESULT_JSON_BYTES, SOURCE_UTF8_BYTES

SDK_REVISION = 3

RESERVED_NAMESPACES = {
    "actionParams",
    "defineParams",
    "handleWebhook",
    "constants",
    "z",
    "console",
    "resetTimeout",
    "keepAlive",
    "Promise",
    "JSON",
    "Date",
    "Math",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Error",
    "TypeError",
    "RangeError",
    "RegExp",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "NaN",
    "Infinity",
    "undefined",
    "requestApproval",
    "saveArtifact",
    "saveMemory",
    "delegate",
    "reportOutcome",
    "readFile",
    "writeFile",
    "listFiles",
    "removeFile",
    "listTables",
    "getTable",
    "listTableRows",
    "writeTableRow",
    "deleteTableRow",
    "listDocuments",
    "readDocument",
    "writeDocument",
}


def configuration_revision(selected):
    configuration = {
        "sdk_revision": SDK_REVISION,
        "plugins": sorted(selected["plugins"], key=lambda plugin: plugin["slug"]),
        "resources": selected.get("resources", {}),
    }
    encoded = json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def plugin_namespace(slug):
    parts = [part for part in slug.split("-") if part]
    if not parts or any(not re.fullmatch(r"[a-z][a-z0-9]*", part) for part in parts):
        return None
    name = parts[0] + "".join(part[0].upper() + part[1:] for part in parts[1:])
    return name if name not in RESERVED_NAMESPACES else None


def project_sdk(project, *, token=None, namespace=None):
    from .services import agent_snapshot

    if isinstance(token, AccessToken) and not token.projects.filter(pk=project.pk).exists():
        raise PermissionDenied("Full SDK discovery requires a project grant.")
    plugins = []
    installed = list(project.plugins.filter(enabled=True).order_by("slug"))
    names = [plugin_namespace(plugin.slug) for plugin in installed]
    for plugin, callable_namespace in zip(installed, names, strict=True):
        available = callable_namespace is not None and names.count(callable_namespace) == 1
        if namespace and namespace != callable_namespace:
            continue
        tools = plugin.release_metadata.get("tools") if plugin.distribution == "external" else None
        safe_tools = None
        if isinstance(tools, list):
            safe_tools = [
                {
                    key: tool[key]
                    for key in (
                        "name",
                        "description",
                        "parameters",
                        "returns",
                        "returnType",
                    )
                    if key in tool
                }
                | {"calling": "named"}
                for tool in tools
                if isinstance(tool, dict) and isinstance(tool.get("name"), str) and tool["name"]
            ]
        plugins.append(
            {
                "namespace": callable_namespace if available else None,
                "available": available,
                "slug": plugin.slug,
                "version": plugin.version,
                "digest": plugin.digest,
                "metadata_complete": available
                and isinstance(tools, list)
                and all(
                    isinstance(tool, dict)
                    and isinstance(tool.get("name"), str)
                    and bool(re.fullmatch(r"[a-z][a-zA-Z0-9]*", tool["name"]))
                    and isinstance(tool.get("parameters"), list)
                    and all(
                        isinstance(parameter, dict)
                        and isinstance(parameter.get("name"), str)
                        and isinstance(parameter.get("type"), str)
                        for parameter in tool["parameters"]
                    )
                    for tool in tools
                ),
                "tools": safe_tools if available else None,
            }
        )
    selected = agent_snapshot(project)
    return {
        "project": str(project.pk),
        "protocol_version": 2,
        "sdk_revision": SDK_REVISION,
        "configuration_revision": configuration_revision(selected),
        "resources": selected.get("resources", {}),
        "limits": {
            "source_utf8_bytes": SOURCE_UTF8_BYTES,
            "inputs_json_utf8_bytes": INPUTS_JSON_UTF8_BYTES,
            "result_json_limit": RESULT_JSON_BYTES,
            "event_count": 200,
            "string_chars": 4096,
            "value_bytes": 16384,
            "queue_bytes": 262144,
            "idle_timeout_ms": 300000,
            "events_page_size": 100,
            "file_utf8_bytes": 200000,
            "files_page_size": 100,
            "files_scan_entries": 10000,
            "file_path_utf8_bytes": 4096,
            "data_json_utf8_bytes": 200000,
            "data_page_size": 100,
        },
        "builtins": []
        if namespace
        else [
            "defineParams<T>(schema: z.ZodType<T>): T",
            "requestApproval(prompt: string): Promise<boolean>",
            "saveArtifact(name: string, content: string): Promise<unknown>",
            "readFile(path: string): Promise<string>",
            "writeFile(path: string, content: string): Promise<{path: string; bytes: number}>",
            "listFiles(path?: string, offset?: number, limit?: number): Promise<unknown>",
            "removeFile(path: string): Promise<void>",
            "listTables(offset?: number, limit?: number): Promise<unknown>",
            "getTable(tableId: string): Promise<unknown>",
            "listTableRows(tableId: string, offset?: number, limit?: number): Promise<unknown>",
            (
                "writeTableRow(tableId: string, tableRevision: number, values: object, "
                "rowId?: string, revision?: number): Promise<unknown>"
            ),
            "deleteTableRow(tableId: string, rowId: string, revision: number): Promise<unknown>",
            "listDocuments(offset?: number, limit?: number): Promise<unknown>",
            "readDocument(documentId: string): Promise<unknown>",
            ("writeDocument(documentId: string, title: string, content: string): Promise<unknown>"),
            "console.log(...values: unknown[]): void",
            "console.warn(...values: unknown[]): void",
            "console.error(...values: unknown[]): void",
        ],
        "plugins": plugins,
        "notes": (
            "Plugin metadata is pinned and read without executing plugin code. "
            "Missing metadata is unknown; do not infer signatures. "
            "Plugin functions are called through their namespace. Return explicitly. "
            "Files are UTF-8 text inside the project workspace and require a Linux executor. "
            "Table and document operations require explicit project resource grants; "
            "write grants include read access. Schema and grant management stay outside execution."
        ),
        "example": (
            "const params = defineParams(z.object({ value: z.number() }));\n"
            "return params.value + 1;"
        ),
    }
