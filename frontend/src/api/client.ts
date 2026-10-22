import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./schema";

export function createApiClient<Paths extends object>(): Client<Paths> {
  const client = createClient<Paths>({ credentials: "same-origin" });

  client.use({
    async onResponse({ response }) {
      if (response.status !== 503) return;
      let body: unknown;
      try {
        body = await response.clone().json();
      } catch {
        return;
      }
      if (
        typeof body === "object" &&
        body !== null &&
        "code" in body &&
        body.code === "setup_required"
      ) {
        // Leave any pending workspace state and open the React setup page.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        location.assign("/setup/");
      }
    },
    onRequest({ request }) {
      if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
      // Session bootstrap sets the cookie; read it afresh after allauth rotates it.
      const token = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("csrftoken="))
        ?.slice("csrftoken=".length);
      if (!token) throw new Error("Reload this page before saving changes.");
      request.headers.set("X-CSRFToken", token);
    },
  });

  return client;
}

export const api = createApiClient<paths>();
