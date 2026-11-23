import { studioAudience } from "../auth/studio";
import { publicRequest } from "./origin";
import { HttpError } from "./responses";

const workspacePath =
  /^\/(?:actions|agents|approvals|artifacts|audit|chat|connections|credentials|documents|people|plugins|projects|runs|schedules|settings|tables|webhooks)?\/?$/;

export function studioRedirect(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (
    !["GET", "HEAD"].includes(request.method) ||
    !workspacePath.test(url.pathname)
  ) {
    return;
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  try {
    const endpoint = new URL(publicRequest(request).url).origin;
    const audience = studioAudience(endpoint);
    if (!audience) {
      return new Response(
        "Studio is disabled. Configure ORGSDK_STUDIO_ORIGIN and the public HTTPS origin for remote access.",
        { status: 503, headers },
      );
    }
    const target = new URL(audience);
    target.pathname = url.pathname;
    target.searchParams.set("server", endpoint);
    for (const key of ["project", "record", "action", "run", "tab", "new"]) {
      const value = url.searchParams.get(key);
      if (value) {
        target.searchParams.set(key, value);
      }
    }
    // An explicit empty fragment prevents browsers carrying an installation fragment across origins.
    headers.set("Location", target.href + "#");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof HttpError) {
      return new Response(error.message, { status: error.status, headers });
    }
    throw error;
  }
}
