"use client";

import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { buttonClass, type Size, type Variant } from "./button-class";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export { buttonClass } from "./button-class";

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant, size, className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

const field = "w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-fg placeholder:text-muted/70 outline-none transition focus:border-fg focus:ring-2 focus:ring-fg/10 disabled:opacity-60";

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-bad">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(field, "h-11", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(field, "py-2.5 min-h-28", className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(field, "h-11 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

const badgeTone = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTone; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", badgeTone[tone])}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const t = { info: "bg-info-soft text-info", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={clsx("rounded-xl px-4 py-3 text-sm font-medium", t)}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Native <dialog>: focus trap, Escape and backdrop come for free. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-card backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full hover:bg-surface-2">
          <X className="size-5" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
