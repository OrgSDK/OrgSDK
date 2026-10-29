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
    id: "project",
    label: "Project",
    items: [
      {
        id: "work",
        description:
          "Build the actions and access available to your connected agent.",
        label: "Overview",
        href: "/projects/",
        icon: Folder,
      },
      {
        id: "actions",
        description: "Build, version and run reusable workflows.",
        label: "Actions",
        href: "/actions/",
        icon: Code2,
      },
      {
        id: "connections",
        description:
          "Connect an external agent to this project's tools over MCP.",
        label: "Connect MCP",
        href: "/connections/",
        icon: Cable,
      },
      {
        id: "plugins",
        description: "Extend the tools available to this project's actions.",
        label: "Plugins",
        href: "/plugins/",
        icon: Package,
      },
    ],
  },
  {
    id: "activity",
    label: "Action activity",
    items: [
      {
        id: "runs",
        description: "Follow execution, review approvals and inspect results.",
        label: "Runs",
        href: "/runs/",
        icon: Play,
      },
      {
        id: "schedules",
        description: "Manage recurring workflows and their next run.",
        label: "Schedules",
        href: "/schedules/",
        icon: CalendarClock,
      },
      {
        id: "webhooks",
        description: "Register action triggers and inspect delivery health.",
        label: "Webhooks",
        href: "/webhooks/",
        icon: Cable,
      },
      {
        id: "approvals",
        description: "Review work that needs a human decision.",
        label: "Approvals",
        href: "/approvals/",
        icon: Bell,
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      {
        id: "home",
        description: "Your workspace at a glance.",
        label: "Workspace home",
        href: "/",
        icon: Home,
      },
      {
        id: "credentials",
        description: "Manage encrypted provider credentials.",
        label: "Credentials",
        href: "/credentials/",
        icon: KeyRound,
      },
      {
        id: "documents",
        description: "Knowledge and memory shared across your workspace.",
        label: "Documents & memory",
        href: "/documents/",
        icon: BookOpen,
      },
      {
        id: "tables",
        label: "Tables",
        href: "/tables/",
        icon: Table2,
      },
      {
        id: "artifacts",
        description: "Inspect and download files produced by your runs.",
        label: "Artifacts",
        href: "/artifacts/",
        icon: Files,
      },
      {
        id: "members",
        description: "Manage access to your workspace.",
        label: "People",
        href: "/people/",
        icon: Users,
      },
      {
        id: "audit",
        label: "Audit log",
        href: "/audit/",
        icon: History,
      },
      {
        id: "settings",
        description: "Workspace access and available capabilities.",
        label: "Settings",
        href: "/settings/",
        icon: Settings,
      },
    ],
  },
];
export const workspacePages = workspaceSections.flatMap((group) => group.items);
// Secondary configuration pages remain directly addressable from Settings.
export const settingsSections = workspacePages.filter((item) =>
  ["credentials", "members", "audit"].includes(item.id),
);
export const actionActivityViews = new Set(
  workspaceSections
    .filter((group) => group.id === "activity")
    .flatMap((group) => group.items.map((item) => item.id)),
);
export const projectViews = new Set(
  workspaceSections
    .filter((group) => group.id !== "workspace")
    .flatMap((group) => group.items.map((item) => item.id)),
);
export const workspaceNavigation = workspaceSections
  .filter((group) => group.id !== "activity")
  .map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      settingsSections.every((secondary) => secondary.id !== item.id),
    ),
  }));
export function workspaceHref(view: string, detail = ""): string {
  const href = workspacePages.find((item) => item.id === view)?.href ?? "/";
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
  return workspacePages.find((item) => item.href === normalized)?.id ?? "home";
}

export function linkedProjectId(
  pathname: string,
  parameters: Pick<URLSearchParams, "get">,
): string | null {
  return (
    parameters.get("project") ??
    (workspaceView(pathname) === "work" ? parameters.get("record") : null)
  );
}
