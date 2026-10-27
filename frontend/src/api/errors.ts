export function apiError(error: unknown): Error {
  if (
    error !== null &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
  ) {
    return new Error(error.detail);
  }
  return new Error(
    Array.isArray(error)
      ? error.join(" ")
      : "Unable to save. Check your details, connection and permissions, then try again.",
  );
}
