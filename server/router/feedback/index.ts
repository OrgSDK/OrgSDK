import { router } from "../procedures";
import { submitProcedure } from "./submit";

export const feedbackRouter = router({ submit: submitProcedure });
