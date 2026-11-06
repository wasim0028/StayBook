"use client";

import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { errorMessage } from "@/lib/client-api";
import { openConversation } from "@/lib/messaging";

export function MessageButton({ start, label, signedIn = true, variant = "outline", className }: { start: { listingId: string } | { bookingId: string }; label: string; signedIn?: boolean; variant?: "outline" | "primary" | "secondary"; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <div className={className}>
      <Button
        variant={variant}
        className="w-full sm:w-auto"
        loading={busy}
        onClick={async () => {
          if (!signedIn) {
            window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
            return;
          }
          setBusy(true);
          setErr(undefined);
          try {
            await openConversation(start);
          } catch (e) {
            setErr(errorMessage(e));
            setBusy(false);
          }
        }}
      >
        {!busy && <MessageSquare className="size-4" />} {label}
      </Button>
      {err && <div className="mt-2"><Alert tone="bad">{err}</Alert></div>}
    </div>
  );
}
