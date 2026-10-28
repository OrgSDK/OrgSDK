import { router } from "./procedures";
import { actionsRouter } from "./actions";
import { approvalsRouter } from "./approvals";
import { artifactsRouter } from "./artifacts";
import { auditRouter } from "./audit";
import { authRouter } from "./auth";
import { conversationsRouter } from "./conversations";
import { credentialsRouter } from "./credentials";
import { documentsRouter } from "./documents";
import { pluginsRouter } from "./plugins";
import { projectsRouter } from "./projects";
import { runsRouter } from "./runs";
import { schedulesRouter } from "./schedules";
import { systemRouter } from "./system";
import { tablesRouter } from "./tables";
import { tokensRouter } from "./tokens";
import { usersRouter } from "./users";
import { webhooksRouter } from "./webhooks";
import { workspaceRouter } from "./workspace";

export const appRouter = router({
  actions: actionsRouter,
  approvals: approvalsRouter,
  artifacts: artifactsRouter,
  audit: auditRouter,
  auth: authRouter,
  conversations: conversationsRouter,
  credentials: credentialsRouter,
  documents: documentsRouter,
  plugins: pluginsRouter,
  projects: projectsRouter,
  runs: runsRouter,
  schedules: schedulesRouter,
  system: systemRouter,
  tables: tablesRouter,
  tokens: tokensRouter,
  users: usersRouter,
  webhooks: webhooksRouter,
  workspace: workspaceRouter,
});
export type AppRouter = typeof appRouter;
