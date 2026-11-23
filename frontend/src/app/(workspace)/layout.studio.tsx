import { StudioConnection } from "../../components/studio/connection";
import type { ReactNode } from "react";
import { WorkspaceLayout } from "../../components/workspace/workspace-context";
export default function Layout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const workspace = <WorkspaceLayout>{children}</WorkspaceLayout>;
  return process.env.NEXT_PUBLIC_ORGSDK_STUDIO === "1" ? (
    <StudioConnection>{workspace}</StudioConnection>
  ) : (
    workspace
  );
}
