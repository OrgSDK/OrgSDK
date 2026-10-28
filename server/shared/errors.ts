export type ServiceErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "PRECONDITION_FAILED";

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const serviceErrorStatus: Record<ServiceErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  TOO_MANY_REQUESTS: 429,
  PRECONDITION_FAILED: 503,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};
