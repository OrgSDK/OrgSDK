import { browserWorkspaceProcedure } from "../procedures";
export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspace = ctx.workspace;
  return [
    { id: workspace.id, name: workspace.name, role: ctx.role, is_active: true },
  ];
});
