import type { ReactNode } from "react";
import { WorkspaceLayout } from "../../components/workspace/workspace-context";
export default function Layout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
