import type { Metadata } from "next";
import Link from "next/link";
import { Table, Td } from "@/components/admin/Table";
import { Alert, Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import type { DirectoryUser } from "@/lib/admin-types";
import { api, ApiError } from "@/lib/api";

export const metadata: Metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  await requireAdmin();
  const { email } = await searchParams;
  let items: DirectoryUser[] | null = null;
  let err: string | null = null;
  if (email && email.trim().length >= 3) {
    try {
      items = (await api<{ items: DirectoryUser[] }>(`/v1/admin/users?email=${encodeURIComponent(email.trim())}`, { auth: true })).items;
    } catch (e) {
      err = e instanceof ApiError && e.status === 400 ? "Use at least 3 characters: letters, digits and . _ % + - @" : "Search failed. Try again.";
    }
  }
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Users</h1>
      <form className="mt-6 flex max-w-xl gap-2" action="/admin/users">
        <input name="email" defaultValue={email} placeholder="Email starts with…" aria-label="Email starts with" className="h-11 flex-1 rounded-xl border border-line bg-surface px-3.5 outline-none focus:border-fg" />
        <button className="h-11 rounded-xl bg-fg px-5 font-semibold text-bg">Search</button>
      </form>
      <p className="mt-2 text-sm text-muted">Searches sign-in emails (prefix match). For a user ID, paste it in the search box at the top.</p>
      {err && <div className="mt-4 max-w-xl"><Alert tone="bad">{err}</Alert></div>}
      {items && (
        <div className="mt-6">
          <Table head={["User", "Email", "Account", "Joined"]} empty={items.length === 0 && { title: "No users found", body: `Nobody's email starts with “${email}”.` }}>
            {items.map((u) => (
              <tr key={u.userId}>
                <Td><Link className="font-semibold hover:underline" href={`/admin/users/${u.userId}`}>{u.name ?? "Unnamed"}</Link></Td>
                <Td>{u.email}</Td>
                <Td>{u.enabled ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Disabled</Badge>} <span className="ml-1 text-xs text-muted">{u.status.toLowerCase().replace(/_/g, " ")}</span></Td>
                <Td className="text-muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
