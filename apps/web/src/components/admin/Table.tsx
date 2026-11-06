import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { Inbox } from "lucide-react";

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: { title: string; body?: string } | false }) {
  if (empty) return <EmptyState icon={<Inbox className="size-6" />} title={empty.title} body={empty.body} />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;

export function Pager({ next, base }: { next: string | null | undefined; base: string }) {
  if (!next) return null;
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div className="mt-4 flex justify-end">
      <Link href={`${base}${sep}cursor=${encodeURIComponent(next)}`} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-fg">Next page →</Link>
    </div>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{children}</code>;
