"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { call, ClientApiError, errorMessage, fieldErrors } from "@/lib/client-api";

const BUSINESS_TYPES: [string, string][] = [
  ["individual", "Individual"],
  ["proprietorship", "Sole proprietorship"],
  ["partnership", "Partnership"],
  ["llp", "LLP"],
  ["private_limited", "Private limited company"],
  ["public_limited", "Public limited company"],
  ["trust", "Trust"],
  ["society", "Society"],
  ["ngo", "NGO"],
];

const STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

/** Client-side checks mirror the server schema so most mistakes are caught before a round trip. */
const CHECKS: Record<string, [RegExp, string]> = {
  phone: [/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"],
  pan: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F"],
  gstin: [/^(|\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])$/, "Check your GSTIN, or leave it empty"],
  postalCode: [/^\d{6}$/, "6-digit PIN code"],
  accountNumber: [/^\d{9,18}$/, "9–18 digits"],
  ifsc: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234"],
};

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-line bg-surface p-6">
      <legend className="sr-only">{title}</legend>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-fg text-sm font-bold text-bg">{n}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function OnboardingForm({ defaultEmail, defaultName }: { defaultEmail?: string; defaultName?: string | null }) {
  const [v, setV] = useState<Record<string, string>>({
    businessType: "individual",
    email: defaultEmail ?? "",
    contactName: defaultName ?? "",
    legalBusinessName: defaultName ?? "",
    state: "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);

  const set = (k: string, upper = false) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: upper ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value }));
  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> & { upper?: boolean } = {}) => {
    const { upper, ...rest } = props;
    return <Input id={k} name={k} value={v[k] ?? ""} onChange={set(k, upper)} aria-invalid={!!errs[k]} {...rest} />;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    for (const [k, [re, msg]] of Object.entries(CHECKS)) if (!re.test(v[k] ?? "")) local[k] = msg;
    for (const k of ["legalBusinessName", "contactName", "email", "street1", "city", "state", "beneficiaryName"]) if (!v[k]?.trim()) local[k] = "Required";
    setErrs(local);
    if (Object.keys(local).length) {
      setErr("Please fix the highlighted fields.");
      document.getElementById(Object.keys(local)[0]!)?.focus();
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      await call("/v1/host/onboarding", {
        method: "POST",
        body: {
          legalBusinessName: v.legalBusinessName!.trim(),
          businessType: v.businessType,
          contactName: v.contactName!.trim(),
          email: v.email!.trim(),
          phone: v.phone,
          pan: v.pan,
          ...(v.gstin ? { gstin: v.gstin } : {}),
          address: { street1: v.street1!.trim(), ...(v.street2?.trim() ? { street2: v.street2.trim() } : {}), city: v.city!.trim(), state: v.state, postalCode: v.postalCode },
          bank: { accountNumber: v.accountNumber, ifsc: v.ifsc, beneficiaryName: v.beneficiaryName!.trim() },
        },
      });
      // New tokens carry the "host" group, which the host pages and API need.
      await fetch("/api/auth/refresh", { method: "POST" });
      setDone(true);
      window.location.href = "/host/listings/new?welcome=1";
    } catch (x) {
      setErrs(fieldErrors(x));
      setErr(x instanceof ClientApiError && x.code === "ONBOARDING_REJECTED" ? `Razorpay couldn't accept these details: ${x.message}. Please check them and try again.` : errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-8 space-y-6">
      <Section n={1} title="You or your business">
        <Field label="Account type" htmlFor="businessType">
          <Select id="businessType" value={v.businessType} onChange={set("businessType")}>
            {BUSINESS_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label={v.businessType === "individual" ? "Full name (as on PAN)" : "Legal business name"} htmlFor="legalBusinessName" error={errs.legalBusinessName}>
          {input("legalBusinessName", { maxLength: 120, autoComplete: "name" })}
        </Field>
        <Field label="PAN" htmlFor="pan" error={errs.pan}>{input("pan", { upper: true, maxLength: 10, placeholder: "ABCDE1234F", autoComplete: "off" })}</Field>
        <Field label="GSTIN (optional)" htmlFor="gstin" error={errs.gstin}>{input("gstin", { upper: true, maxLength: 15, autoComplete: "off" })}</Field>
      </Section>

      <Section n={2} title="Contact">
        <Field label="Contact person" htmlFor="contactName" error={errs.contactName}>{input("contactName", { maxLength: 80 })}</Field>
        <Field label="Email" htmlFor="email" error={errs.email}>{input("email", { type: "email", autoComplete: "email", maxLength: 120 })}</Field>
        <Field label="Mobile" htmlFor="phone" error={errs.phone}>
          <Input id="phone" inputMode="numeric" maxLength={10} value={v.phone ?? ""} onChange={(e) => setV((x) => ({ ...x, phone: e.target.value.replace(/\D/g, "") }))} aria-invalid={!!errs.phone} autoComplete="tel-national" />
        </Field>
      </Section>

      <Section n={3} title="Address">
        <div className="sm:col-span-2"><Field label="Address line 1" htmlFor="street1" error={errs.street1}>{input("street1", { maxLength: 120, autoComplete: "address-line1" })}</Field></div>
        <div className="sm:col-span-2"><Field label="Address line 2 (optional)" htmlFor="street2">{input("street2", { maxLength: 120, autoComplete: "address-line2" })}</Field></div>
        <Field label="City" htmlFor="city" error={errs.city}>{input("city", { maxLength: 60, autoComplete: "address-level2" })}</Field>
        <Field label="State" htmlFor="state" error={errs.state}>
          <Select id="state" value={v.state} onChange={set("state")} aria-invalid={!!errs.state}>
            <option value="" disabled>Select state</option>
            {STATES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="PIN code" htmlFor="postalCode" error={errs.postalCode}>{input("postalCode", { inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" })}</Field>
      </Section>

      <Section n={4} title="Bank account for payouts">
        <div className="sm:col-span-2"><Field label="Account holder name" htmlFor="beneficiaryName" error={errs.beneficiaryName}>{input("beneficiaryName", { maxLength: 80 })}</Field></div>
        <Field label="Account number" htmlFor="accountNumber" error={errs.accountNumber}>
          <Input id="accountNumber" inputMode="numeric" maxLength={18} value={v.accountNumber ?? ""} onChange={(e) => setV((x) => ({ ...x, accountNumber: e.target.value.replace(/\D/g, "") }))} aria-invalid={!!errs.accountNumber} autoComplete="off" />
        </Field>
        <Field label="IFSC" htmlFor="ifsc" error={errs.ifsc}>{input("ifsc", { upper: true, maxLength: 11, placeholder: "HDFC0001234", autoComplete: "off" })}</Field>
      </Section>

      {err && <Alert tone="bad">{err}</Alert>}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={busy || done}>Create payout account</Button>
        <p className="flex items-center gap-1.5 text-sm text-muted"><Lock className="size-4" /> Sent securely to Razorpay. We keep only the last 4 digits of your account.</p>
      </div>
    </form>
  );
}
