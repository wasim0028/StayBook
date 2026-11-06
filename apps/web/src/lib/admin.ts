import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSession } from "./api";

/** Staff pages 404 for everyone else, so the console's existence isn't advertised. */
export async function requireStaff() {
  const s = await getSession();
  if (!s) redirect("/auth/login?next=/admin");
  if (!s.isAdmin && !s.isAnalyst) notFound();
  return s;
}

export async function requireAdmin() {
  const s = await requireStaff();
  if (!s.isAdmin) notFound();
  return s;
}
