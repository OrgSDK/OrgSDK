import type { AppDatabase } from "./db/database";
import type { SecretCipher } from "./shared/secrets";

export type AppDependencies = {
  db: AppDatabase;
  secrets: SecretCipher;
};

import type { accessTokens, users, workspaces } from "./db/schema";

type User = typeof users.$inferSelect;
type Workspace = typeof workspaces.$inferSelect;
type Token = typeof accessTokens.$inferSelect;
export type ServiceContext = {
  db: AppDependencies["db"];
  secrets: AppDependencies["secrets"];
  user: User | null;
  workspace: Workspace | null;
  role: string | null;
  token: Token | null;
  sessionId: string | null;
  userId: number | null;
  operationType: "query" | "mutation" | "subscription";
  origin: string;
  hostname: string;
};
