import { z } from "zod";

export const stableVersion = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
export function newerStable(candidate: string, installed: string): boolean {
  if (
    !stableVersion.safeParse(candidate).success ||
    !stableVersion.safeParse(installed).success
  ) {
    return false;
  }
  const current = installed.split(".");
  for (const [index, part] of candidate.split(".").entries()) {
    const difference = Number(part) - Number(current[index]);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

const release = z.object({
  name: z.literal("@orgsdk/cli"),
  version: stableVersion,
});
let cached: Promise<string | null> | undefined;
let expires = 0;
export function latestStable(): Promise<string | null> {
  if (cached && expires > Date.now()) {
    return cached;
  }
  expires = Date.now() + 60 * 60_000;
  cached = fetch("https://registry.npmjs.org/@orgsdk%2fcli/latest", {
    signal: AbortSignal.timeout(3500),
    redirect: "error",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("Registry unavailable.");
      }
      return release.parse(await response.json()).version;
    })
    .catch(() => {
      expires = Date.now() + 60_000;
      return null;
    });
  return cached;
}
