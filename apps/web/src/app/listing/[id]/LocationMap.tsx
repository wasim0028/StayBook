"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

const Inner = dynamic(() => import("./LocationMapInner"), { ssr: false, loading: () => <Skeleton className="size-full rounded-none" /> });

export function LocationMap(p: { lat: number; lng: number }) {
  return <Inner {...p} />;
}
