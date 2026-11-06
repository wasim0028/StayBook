"use client";

import { CloudOff } from "lucide-react";
import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-surface-2 text-muted"><CloudOff className="size-8" /></div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted">We couldn&apos;t load this page. It&apos;s probably temporary.</p>
      {error.digest && <p className="mt-1 text-xs text-muted">Reference: {error.digest}</p>}
      <div className="mt-8 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/" variant="outline">Home</LinkButton>
      </div>
    </div>
  );
}
