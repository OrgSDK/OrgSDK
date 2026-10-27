// Adapted from restored AIOrg WorkspaceHomeCards.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
export function SignalCard({
  label,
  value,
  hint,
  onClick,
  hasWarning = false,
}: {
  label: string;
  value: string;
  hint: string;
  onClick: () => void;
  hasWarning?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`signal-card ${hasWarning ? "has-warning" : ""}`}
    >
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span>{hint}</span>
    </button>
  );
}
export function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button type="button" className="quick-action" onClick={onClick}>
      <Icon size={19} aria-hidden="true" />
      <strong>{label}</strong>
      <span>{description}</span>
    </button>
  );
}
