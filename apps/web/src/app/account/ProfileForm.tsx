"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { call, errorMessage, fieldErrors } from "@/lib/client-api";
import type { Me } from "@/lib/types";

export function ProfileForm({ me }: { me: Me }) {
  const router = useRouter();
  const [displayName, setName] = useState(me.displayName ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; err?: string; fields?: Record<string, string> }>({});

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    if (displayName.trim() && displayName.trim() !== me.displayName) body.displayName = displayName.trim();
    if (bio.trim() !== (me.bio ?? "")) body.bio = bio.trim();
    if (phone && phone !== me.phone) body.phone = phone;
    if (Object.keys(body).length === 0) return setState({ ok: true });
    setState({ busy: true });
    try {
      await call("/v1/me", { method: "PUT", body });
      setState({ ok: true });
      router.refresh();
    } catch (x) {
      const fields = fieldErrors(x);
      setState({ err: Object.keys(fields).length ? "Please fix the highlighted fields." : errorMessage(x), fields });
    }
  }

  return (
    <form onSubmit={save} className="mt-10 space-y-5 rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">Your details</h2>
      <Field label="Display name" htmlFor="dn" hint="Shown to hosts and on your reviews." error={state.fields?.displayName}>
        <Input id="dn" maxLength={60} value={displayName} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Mobile number" htmlFor="ph" hint="10-digit Indian mobile, shared with your host after booking." error={state.fields?.phone}>
        <Input id="ph" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="About you" htmlFor="bio" error={state.fields?.bio}>
        <Textarea id="bio" maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line or two about yourself helps hosts get to know you." />
      </Field>
      {state.err && <Alert tone="bad">{state.err}</Alert>}
      {state.ok && <Alert tone="ok">Saved.</Alert>}
      <Button type="submit" loading={state.busy}>Save changes</Button>
    </form>
  );
}
