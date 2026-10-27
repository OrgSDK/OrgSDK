export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function json(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return Response.json(value, { status, ...(headers ? { headers } : {}) });
}

export async function input(request: Request): Promise<Record<string, any>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Expected a JSON object.");
  }
}

export function page<T>(results: T[]) {
  return { count: results.length, next: null, previous: null, results };
}
