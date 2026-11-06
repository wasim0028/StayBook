"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Modal, Textarea } from "@/components/ui";
import { call, errorMessage } from "@/lib/client-api";

type Variant = "primary" | "outline" | "danger" | "secondary";

/**
 * A staff action behind a confirmation. With `reason`, the reviewer must say why (it goes to the
 * audit log). Refreshes the page's server data on success.
 */
export function AdminAction({ path, label, title, body, confirmLabel, reason, variant = "outline", size = "sm" }: { path: string; label: string; title: string; body: string; confirmLabel: string; reason?: boolean; variant?: Variant; size?: "sm" | "md" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<string>();

  async function run() {
    setBusy(true);
    setErr(undefined);
    try {
      await call(path, { method: "POST", body: reason ? { reason: why.trim() } : undefined });
      setOpen(false);
      setWhy("");
      setDone("Done");
      router.refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => { setOpen(true); setDone(undefined); }}>{label}</Button>
      {done && <span className="sr-only" role="status">{done}</span>}
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p className="text-[15px] text-muted">{body}</p>
        {reason && (
          <div className="mt-4">
            <label htmlFor={`why-${path}`} className="text-sm font-medium">Reason (kept in the audit log)</label>
            <Textarea id={`why-${path}`} className="mt-1.5 min-h-20" maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Guest reported fake photos; confirmed with host" />
          </div>
        )}
        {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} onClick={run} loading={busy} disabled={reason && why.trim().length < 3}>{confirmLabel}</Button>
        </div>
      </Modal>
    </>
  );
}
