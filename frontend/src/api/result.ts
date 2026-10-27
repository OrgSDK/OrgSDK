export function result<T>(response: { data?: T; error?: unknown }): T {
  if (response.error !== undefined || response.data === undefined) {
    throw new Error(
      response.error === undefined
        ? "The request returned no data."
        : JSON.stringify(response.error),
    );
  }
  return response.data;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request failed. Please try again.";
}

export function requireSuccess(response: {
  response: Response;
  error?: unknown;
}): void {
  if (!response.response.ok || response.error !== undefined) {
    throw new Error(
      response.error === undefined
        ? `Request failed (${String(response.response.status)}).`
        : JSON.stringify(response.error),
    );
  }
}
