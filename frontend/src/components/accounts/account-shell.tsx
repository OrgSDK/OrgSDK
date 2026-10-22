import Link from "next/link";
import type { ReactNode } from "react";
import { BotMark } from "../workspace/brand";

export function AccountShell({
  title,
  description,
  children,
  showAccountNavigation = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  showAccountNavigation?: boolean;
}): ReactNode {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold text-slate-900"
        >
          <BotMark className="h-9 w-9" />
          OrgSDK
        </Link>
        <Link href="/" className="text-sm">
          Back to app
        </Link>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:py-16">
        {showAccountNavigation && (
          <nav
            aria-label="Account"
            className="mb-6 flex flex-wrap gap-4 text-sm"
          >
            <Link href="/accounts/email/">Account</Link>
            <Link href="/accounts/password/change/">Password</Link>
            <Link href="/accounts/2fa/">Two-factor authentication</Link>
            <Link href="/accounts/logout/">Sign out</Link>
          </nav>
        )}
        <section className="panel">
          <h1 className="!text-2xl">{title}</h1>
          {description && <p className="mb-6 text-sm">{description}</p>}
          {children}
        </section>
      </main>
    </div>
  );
}
