import { browserProcedure } from "../procedures";
import { requireIdentityWorkspace } from "../../auth/context";
export const listProcedure = browserProcedure.query(({ ctx }) => {
  const workspace = requireIdentityWorkspace(ctx);
  return [
    { id: workspace.id, name: workspace.name, role: ctx.role, is_active: true },
  ];
});
