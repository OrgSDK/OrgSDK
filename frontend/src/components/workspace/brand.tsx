import type { ReactNode, SVGProps } from "react";

export function BotMark({
  className,
  ...properties
}: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
      {...properties}
    >
      <circle cx="32" cy="32" r="19" stroke="#4f46e5" strokeWidth="12" />
      <circle cx="50" cy="14" r="6" fill="#8b5cf6" />
    </svg>
  );
}
