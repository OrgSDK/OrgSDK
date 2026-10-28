import { type AppContext } from "../http/context";
import { recordAuthAttempt } from "../repositories/auth-attempts";
import { digest } from "../shared/security";
export function throttle(ctx: AppContext, key: string) {
  recordAuthAttempt(ctx.store, digest(key), Date.now());
}
