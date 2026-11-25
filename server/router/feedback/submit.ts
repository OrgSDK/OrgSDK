import { version } from "../../../package.json";
import { feedbackInput, receipt } from "../../feedback/contract";
import { ServiceError } from "../../shared/errors";
import { digest } from "../../shared/security";
import { scopedProcedure } from "../procedures";

export const submitProcedure = scopedProcedure("feedback:submit")
  .input(feedbackInput)
  .mutation(async ({ ctx, input }) => {
    const { idempotency_key, ...report } = input;
    const sender = ctx.token?.id ?? [
      ctx.workspace.createdAt,
      ctx.workspace.id,
      ctx.userId,
    ];
    const submissionKey = digest(JSON.stringify([sender, idempotency_key]));
    const unavailable =
      "Feedback delivery could not be confirmed. Retry with the same idempotency key.";
    let response: Response;
    try {
      response = await fetch("https://feedback.orgsdk.ai/v1/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          ...report,
          submission_key: submissionKey,
          platform_version: version,
        }),
      });
    } catch {
      throw new ServiceError("PRECONDITION_FAILED", unavailable);
    }
    if (response.status === 409) {
      throw new ServiceError(
        "CONFLICT",
        "This key was used for different feedback. Use a fresh key for a new report.",
      );
    }
    if (response.status === 429) {
      throw new ServiceError(
        "TOO_MANY_REQUESTS",
        "The feedback inbox is busy. Wait one minute and retry with the same key.",
      );
    }
    if (!response.ok) {
      throw new ServiceError("PRECONDITION_FAILED", unavailable);
    }
    const result = receipt.safeParse(await response.json().catch(() => null));
    if (!result.success) {
      throw new ServiceError("PRECONDITION_FAILED", unavailable);
    }
    return result.data;
  });
