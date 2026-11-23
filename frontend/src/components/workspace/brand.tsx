import Image from "next/image";
import type { ReactNode } from "react";
import wordmark from "./orgsdk-wordmark.webp";

export function OrgSdkWordmark({
  className,
}: {
  className?: string;
}): ReactNode {
  return (
    <Image src={wordmark} alt="OrgSDK" className={className} unoptimized />
  );
}
