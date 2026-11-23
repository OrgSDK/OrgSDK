"use client";
import Image from "next/image";
import { Package } from "lucide-react";
import { useState, type ReactNode } from "react";

const catalogIcons = new Map([
  ["asana", "/plugins/icons/asana.ico"],
  ["browser", "/plugins/icons/browser-cdp.png"],
  ["browser-cdp", "/plugins/icons/browser-cdp.png"],
  ["data", "/plugins/icons/data.svg"],
  ["facebook", "/plugins/icons/facebook.svg"],
  ["github", "/plugins/icons/github.svg"],
  ["gmail", "/plugins/icons/gmail.svg"],
  ["google-drive", "/plugins/icons/google-drive.svg"],
  ["google-sheets", "/plugins/icons/google-sheets.svg"],
  ["google-tasks", "/plugins/icons/google-tasks.svg"],
  ["harvest", "/plugins/icons/harvest.svg"],
  ["linkedin", "/plugins/icons/linkedin.png"],
  ["llm", "/plugins/icons/llm.svg"],
  ["serper", "/plugins/icons/serper.png"],
  ["servicem8", "/plugins/icons/servicem8.png"],
  ["shippo", "/plugins/icons/shippo.png"],
  ["shopify", "/plugins/icons/shopify.png"],
  ["twitter", "/plugins/icons/twitter.svg"],
  ["xero", "/plugins/icons/xero.svg"],
  ["zendesk", "/plugins/icons/zendesk.svg"],
]);

function httpsIcon(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function PluginIcon({
  url,
  catalogSlug = "",
  size = 32,
}: {
  url: string | undefined;
  catalogSlug?: string | undefined;
  size?: number;
}): ReactNode {
  const localIcon = catalogIcons.get(catalogSlug) ?? "";
  const remoteIcon = httpsIcon(url);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const preferredIcon =
    localIcon && remoteIcon === `https://orgsdk.ai${localIcon}`
      ? localIcon
      : remoteIcon;
  const source = [preferredIcon, localIcon].find(
    (candidate) => candidate.length > 0 && !failedSources.includes(candidate),
  );
  if (!source)
    return <Package size={size} className="shrink-0" aria-hidden="true" />;
  return (
    <Image
      src={source}
      alt=""
      width={size}
      height={size}
      unoptimized
      referrerPolicy="no-referrer"
      className="shrink-0 object-contain"
      onError={() => {
        setFailedSources((failed) => [...failed, source]);
      }}
    />
  );
}
