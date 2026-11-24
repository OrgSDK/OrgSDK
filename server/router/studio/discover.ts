import { publicProcedure } from "../procedures";
import { isLoopbackInstallation, studioAudience } from "../../auth/studio";
import { ServiceError } from "../../shared/errors";
export const discover = publicProcedure.query(({ ctx }) => {
  const audience = studioAudience(ctx.origin);
  if (!audience) {
    throw new ServiceError(
      "FORBIDDEN",
      "Studio is disabled for this installation.",
    );
  }
  return {
    product: "orgsdk" as const,
    protocol: 1 as const,
    audience,
    localSignIn: isLoopbackInstallation(ctx.origin),
  };
});
