import { z } from "zod";
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

export async function input(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    return z.record(z.string(), z.unknown()).parse(value);
  } catch {
    throw new HttpError(400, "Expected a JSON object.");
  }
}
