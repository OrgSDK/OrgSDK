import type { ServiceContext } from "../application";
export {
  requireUser as requireIdentity,
  requireWorkspace as requireIdentityWorkspace,
  requireManager as requireIdentityManager,
} from "../shared/authorization";

export type IdentityContext = ServiceContext & {
  sessionChanged: (secret: string | null) => void;
};
