import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { randomSecret } from "../../shared/security";
import { assertCurrentUser, rotateSession } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { loginSchema } from "../../auth/schemas";
let dummyPasswordHash: Promise<string> | undefined;
export const loginProcedure = browserProcedure
  .input(loginSchema)
  .mutation(async ({ ctx: requestContext, input }) => {
    const ctx = identityContext(requestContext);

    const email = input.email.trim().toLowerCase();
    throttle(ctx, `login:${email}`);
    const user = identityRepository(ctx.db).userByEmail(email);
    dummyPasswordHash ??= Bun.password.hash(randomSecret());
    const valid = await Bun.password.verify(
      input.password,
      user?.passwordHash ?? (await dummyPasswordHash),
    );
    if (!user || !valid || !ctx.workspace) {
      throw new ServiceError("BAD_REQUEST", "Invalid email or password.");
    }
    if (user.totpSecret) {
      rotateSession(ctx, null, user.id, (ctx) =>
        assertCurrentUser(ctx, user, false),
      );
      ctx.user = null;
      return authState(ctx, ["mfa_authenticate"]);
    }
    rotateSession(ctx, user.id, null, (ctx) =>
      assertCurrentUser(ctx, user, false),
    );
    ctx.user = user;
    return authState(ctx);
  });
