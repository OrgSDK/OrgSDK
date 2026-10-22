import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "OrgSDK",
  applicationName: "OrgSDK",
  icons: {
    icon: { url: "/favicon.svg?v=orbit-o", type: "image/svg+xml" },
    shortcut: "/favicon.ico",
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  description: "Agents, repeatable actions and observable execution.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};
export default function Layout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
