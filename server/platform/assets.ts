import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function assetDirectory(name: "out" | "migrations"): string {
  const bundled = resolve(import.meta.dirname, name);
  if (existsSync(bundled)) {
    return bundled;
  }
  return name === "out"
    ? resolve(import.meta.dirname, "../../frontend/out")
    : resolve(import.meta.dirname, "../db/migrations");
}
