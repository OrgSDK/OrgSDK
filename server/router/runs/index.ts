import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { createProcedure } from "./create";
import { eventsProcedure } from "./events";
import { retryProcedure } from "./retry";
import { cancelProcedure } from "./cancel";
import { promoteProcedure } from "./promote";
import { streamProcedure } from "./stream";

import { sessionProcedure } from "./session";

export const runsRouter = router({
  list: listProcedure,
  get: getProcedure,
  create: createProcedure,
  session: sessionProcedure,
  events: eventsProcedure,
  retry: retryProcedure,
  cancel: cancelProcedure,
  promote: promoteProcedure,
  stream: streamProcedure,
});
