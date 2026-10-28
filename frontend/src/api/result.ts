export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request failed. Please try again.";
}
