import { HttpError } from "./http";

// The configured public origin is the only trusted scheme/host override. Forwarded
// headers are deliberately ignored, so an arbitrary client cannot select it.
export function publicRequest(request: Request): Request {
  const configured = process.env.ORGSDK_PUBLIC_ORIGIN;
  if (!configured) return request;
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new HttpError(503, "Invalid public origin configuration.");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new HttpError(503, "Invalid public origin configuration.");
  const url = new URL(request.url);
  url.protocol = origin.protocol;
  if (url.host !== origin.host)
    throw new HttpError(
      400,
      "Request hostname does not match this installation.",
    );
  return new Request(url, request);
}
