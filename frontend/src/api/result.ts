export function errorMessage(
  error: unknown,
  fallback = "The request failed. Please try again.",
): string {
  return error instanceof Error ? error.message : fallback;
}
