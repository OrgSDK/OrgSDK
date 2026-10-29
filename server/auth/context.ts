import type { ServiceContext } from "../application";
export type IdentityContext = ServiceContext & {
  sessionChanged: (secret: string | null) => void;
};
