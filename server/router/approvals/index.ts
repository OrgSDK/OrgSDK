import { router } from "../procedures";
import { listProcedure } from "./list";
import { getProcedure } from "./get";
import { decideProcedure } from "./decide";

export const approvalsRouter = router({
  list: listProcedure,
  get: getProcedure,
  decide: decideProcedure,
});
