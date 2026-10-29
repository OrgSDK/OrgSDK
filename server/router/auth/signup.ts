import { password as passwords } from "../../platform/password";
import { browserProcedure } from "../procedures";
import { identityContext } from "../identity-context";
import { ServiceError } from "../../shared/errors";
import { identityRepository } from "../../repositories/identity";
import { rotateSession } from "../../auth/sessions";
import { throttle } from "../../auth/throttle";
import { authState } from "../../auth/views";
import { createAccount } from "../../auth/queries";
import { signupSchema } from "../../auth/schemas";
export const signupProcedure = browserProcedure
  .input(signupSchema)
  .mutation(async ({ ctx: requestContext, input }) => {
    const ctx = identityContext(requestContext);

    if (!ctx.workspace) {
      throw new ServiceError("NOT_FOUND", "Unregistered workspace.");
    }
    const email = input.email.trim().toLowerCase();
    throttle(ctx, `signup:${email}`);
    if (identityRepository(ctx.db).userByEmail(email)) {
      throw new ServiceError("BAD_REQUEST", "This email is already in use.");
    }
    const passwordHash = await passwords.hash(input.password);
    try {
      const user = createAccount(ctx.db, {
        email,
        username: input.username.trim(),
        passwordHash,
      });
      rotateSession(ctx, user.id);
      ctx.user = user;
      return authState(ctx);
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw new ServiceError(
        "BAD_REQUEST",
        "This email or username is already in use.",
      );
    }
  });
