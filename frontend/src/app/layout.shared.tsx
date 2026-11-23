import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title:
    process.env.NEXT_PUBLIC_ORGSDK_STUDIO === "1" ? "OrgSDK Studio" : "OrgSDK",
  applicationName: "OrgSDK",
  icons: {
    icon: { url: "/favicon.png?v=20261023", type: "image/png", sizes: "96x96" },
    shortcut: "/favicon.ico?v=20261023",
    apple: { url: "/apple-touch-icon.png?v=20261023", sizes: "180x180" },
  },
  description: "Agents, repeatable actions and observable execution.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf8f3",
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
