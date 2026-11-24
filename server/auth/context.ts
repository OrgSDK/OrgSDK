import type { ServiceContext } from "../application";
export type IdentityContext = ServiceContext & {
  studioOrigin?: string | undefined;
  sessionChanged: (secret: string | null) => void;
};
