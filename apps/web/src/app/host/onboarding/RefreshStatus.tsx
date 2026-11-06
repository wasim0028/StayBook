"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { call } from "@/lib/client-api";

export function RefreshStatus() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await call("/v1/host/onboarding?refresh=true");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {!busy && <RefreshCw className="size-4" />} Check status
    </Button>
  );
}
