"use client";
import Image from "next/image";
import { Package } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  size = 32,
}: {
  url: string | undefined;
  size?: number;
}): ReactNode {
  const source = httpsIcon(url);
  const [failedSource, setFailedSource] = useState("");
  if (!source || failedSource === source)
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
        setFailedSource(source);
      }}
    />
  );
}
