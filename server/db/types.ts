export type JsonValue =
  string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type TableColumn = {
  key: string;
  type: "text" | "number" | "boolean" | "date";
  required: boolean;
};
export type PluginMetadata = JsonObject & {
  auth?: JsonObject & { type?: string; provider?: string; scopes?: string[] };
  marketplace?: JsonObject & { icon_url?: string };
  description?: string;
  slug?: string;
  version?: string;
  digest?: string;
  package_url?: string;
};
