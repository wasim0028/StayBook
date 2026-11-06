import type { Metadata } from "next";
import { requireStaff } from "@/lib/admin";
import { AdminNav } from "./AdminNav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · StayBook" }, robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <AdminNav isAdmin={s.isAdmin} />
      <div className="mt-8">{children}</div>
    </div>
  );
}
