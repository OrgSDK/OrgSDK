"use client";
import { Button } from "../ui/button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { BotMark } from "./brand";
import {
  workspaceNavigation as navigation,
  workspaceSections,
  settingsSections,
  actionActivityViews,
  projectHref,
  projectViews,
} from "./routes";
import { WorkspaceLink } from "./workspace-link";
import { PageHeaderContext } from "./page-header";
import { ProjectSelector } from "./project-selector";
import { useWorkspace } from "./workspace-context";
export function WorkspaceShell({
  workspace,
  tab,
  children,
}: {
  workspace: string;
  tab: string;
  children: ReactNode;
}): ReactNode {
  const { agents: projects, selected } = useWorkspace();
  const project = projects.find((item) => item.id === selected);
  const [open, setOpen] = useState(false);
  const [pageHeader, setPageHeader] = useState<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const dismiss = (): void => {
    setOpen(false);
  };
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) trigger.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = drawer.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), select:not([disabled])",
      );
      const first = items?.[0];
      const last = items?.[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 768px)");
    const closeOnDesktop = (): void => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, []);
  const title =
    workspaceSections
      .flatMap((group) => group.items)
      .find((item) => item.id === tab)?.label ?? "Projects";
  return (
    <div className="shell">
      {open ? (
        <div className="drawer-backdrop" aria-hidden="true" onClick={dismiss} />
      ) : undefined}
      <aside
        ref={drawer}
        id="workspace-navigation"
        className={`workspace-sidebar ${open ? "is-open" : ""}`}
        aria-label="Workspace navigation"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
      >
        <div className="workspace-brand">
          <BotMark className="bot-mark" />
          <span>OrgSDK</span>
          <Button
            ref={close}
            className="mobile-only icon-button secondary"
            onClick={dismiss}
            aria-label="Close navigation"
          >
            <X size={18} />
          </Button>
        </div>
        <ProjectSelector onNavigate={dismiss} />
        <nav className="flex flex-col" aria-label="Project and workspace">
          {navigation.map((group) => (
            <div
              className={`nav-group ${group.label === "Workspace" ? "mt-auto pt-6" : ""}`}
              key={group.label}
            >
              <p className="eyebrow">{group.label}</p>
              {group.items.map((item) => {
                const isActive =
                  tab === item.id ||
                  (item.id === "actions" && actionActivityViews.has(tab)) ||
                  (item.id === "settings" &&
                    settingsSections.some((secondary) => secondary.id === tab));
                const content = (
                  <>
                    <item.icon size={17} aria-hidden="true" />
                    {item.label}
                  </>
                );
                return (
                  <WorkspaceLink
                    href={projectHref(item.id, selected)}
                    key={item.id}
                    aria-current={isActive ? "page" : undefined}
                    className={isActive ? "active" : ""}
                    onNavigate={dismiss}
                  >
                    {content}
                  </WorkspaceLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="workspace-label">
          <span className="workspace-avatar">
            {workspace.slice(0, 1).toUpperCase()}
          </span>
          <span>
            {workspace}
            <small>Local workspace</small>
          </span>
        </div>
      </aside>
      <div className="workspace-body" inert={open}>
        <header
          className={`workspace-header ${tab === "actions" ? "workspace-action-header" : ""}`}
        >
          <div className="row">
            <Button
              ref={trigger}
              className="mobile-only icon-button secondary"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="workspace-navigation"
              onClick={() => {
                setOpen(true);
              }}
            >
              <Menu size={18} />
            </Button>
            {tab === "actions" ? null : (
              <>
                <span className="muted max-w-52 truncate">
                  {projectViews.has(tab)
                    ? (project?.name ?? "Project")
                    : workspace}
                </span>
                <span className="breadcrumb-divider">/</span>
                <strong>{title}</strong>
              </>
            )}
          </div>
          {tab === "actions" ? (
            <div className="workspace-page-header" ref={setPageHeader} />
          ) : (
            <span className="badge">{workspace}</span>
          )}
        </header>
        <main className={tab === "actions" ? "action-page" : undefined}>
          <div className={tab === "actions" ? "sr-only" : "page-heading"}>
            <h1>{title}</h1>
            <p>
              {
                {
                  home: "Your workspace at a glance.",
                  work: "Build the actions and access available to your connected agent.",
                  schedules: "Manage recurring workflows and their next run.",
                  webhooks:
                    "Register action triggers and inspect delivery health.",
                  approvals: "Review work that needs a human decision.",
                  artifacts:
                    "Inspect and download files produced by your runs.",
                  plugins:
                    "Extend the tools available to this project's actions.",
                  credentials: "Manage encrypted provider credentials.",
                  settings: "Workspace access and available capabilities.",
                  actions: "Build, version and run reusable workflows.",
                  runs: "Follow execution, review approvals and inspect results.",
                  documents:
                    "Knowledge and memory shared across your workspace.",
                  connections:
                    "Connect an external agent to this project's tools over MCP.",
                  members: "Manage access to your workspace.",
                }[tab]
              }
            </p>
          </div>
          <PageHeaderContext value={pageHeader}>{children}</PageHeaderContext>
        </main>
      </div>
    </div>
  );
}
