"use client";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page(): ReactNode {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/projects/${location.search}`);
  }, [router]);
  return <p role="status">Opening projects…</p>;
}
