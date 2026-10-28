import { type ServiceContext } from "../application";
import { recordAuthAttempt } from "../repositories/auth-attempts";
import { digest } from "../shared/security";
export function throttle(ctx: ServiceContext, key: string) {
  recordAuthAttempt(ctx, digest(key), Date.now());
}
