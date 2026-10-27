import {
  Bell,
  History,
  BookOpen,
  Folder,
  Cable,
  CalendarClock,
  Code2,
  Files,
  Home,
  KeyRound,
  Package,
  Play,
  Settings,
  Table2,
  Users,
} from "lucide-react";
export const workspaceSections = [
  {
    label: "Project",
    items: [
      { id: "work", label: "Overview", href: "/projects/", icon: Folder },
      { id: "actions", label: "Actions", href: "/actions/", icon: Code2 },
      {
        id: "connections",
        label: "Connect MCP",
        href: "/connections/",
        icon: Cable,
      },
      { id: "plugins", label: "Plugins", href: "/plugins/", icon: Package },
    ],
  },
  {
    label: "Action activity",
    items: [
      { id: "runs", label: "Runs", href: "/runs/", icon: Play },
      {
        id: "schedules",
        label: "Schedules",
        href: "/schedules/",
        icon: CalendarClock,
      },
      { id: "webhooks", label: "Webhooks", href: "/webhooks/", icon: Cable },
      { id: "approvals", label: "Approvals", href: "/approvals/", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "home", label: "Workspace home", href: "/", icon: Home },
      {
        id: "credentials",
        label: "Credentials",
        href: "/credentials/",
        icon: KeyRound,
      },
      {
        id: "documents",
        label: "Documents & memory",
        href: "/documents/",
        icon: BookOpen,
      },
      { id: "tables", label: "Tables", href: "/tables/", icon: Table2 },
      { id: "artifacts", label: "Artifacts", href: "/artifacts/", icon: Files },
      { id: "members", label: "People", href: "/people/", icon: Users },
      { id: "audit", label: "Audit log", href: "/audit/", icon: History },
      { id: "settings", label: "Settings", href: "/settings/", icon: Settings },
    ],
  },
];
// Secondary configuration pages remain directly addressable from Settings.
export const settingsSections = workspaceSections
  .flatMap((group) => group.items)
  .filter((item) => ["credentials", "members", "audit"].includes(item.id));
export const actionActivityViews = new Set([
  "runs",
  "schedules",
  "webhooks",
  "approvals",
]);
export const projectViews = new Set([
  "work",
  "actions",
  "connections",
  "plugins",
  ...actionActivityViews,
]);
export const workspaceNavigation = workspaceSections
  .filter((group) => group.label !== "Action activity")
  .map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      settingsSections.every((secondary) => secondary.id !== item.id),
    ),
  }));
export function workspaceHref(view: string, detail = ""): string {
  const href =
    workspaceSections
      .flatMap((group) => group.items)
      .find((item) => item.id === view)?.href ?? "/";
  if (!detail) return href;
  const keys: Record<string, string> = { runs: "run", actions: "action" };
  const key = keys[view] ?? "record";
  return `${href}?${new URLSearchParams({ [key]: detail }).toString()}`;
}
export function projectHref(
  view: string,
  project: string,
  detail = "",
): string {
  const href = workspaceHref(view, detail);
  if (!project || !projectViews.has(view)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams({ project }).toString()}`;
}

export function projectSwitchHref(view: string, project: string): string {
  if (actionActivityViews.has(view)) return projectHref("actions", project);
  const destination = projectViews.has(view) ? view : "work";
  return projectHref(destination, project);
}
export function workspaceView(pathname: string): string {
  const normalized = pathname === "/" ? "/" : `${pathname.replace(/\/$/, "")}/`;
  return (
    workspaceSections
      .flatMap((group) => group.items)
      .find((item) => item.href === normalized)?.id ?? "home"
  );
}
