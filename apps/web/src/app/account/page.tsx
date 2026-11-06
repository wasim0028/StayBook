import type { Metadata } from "next";
import { api, getSession } from "@/lib/api";
import type { Me } from "@/lib/types";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Profile" };

export default async function AccountPage() {
  const [me, session] = await Promise.all([api<Me>("/v1/me", { auth: true }), getSession()]);
  const name = me.displayName ?? session?.name ?? session?.email ?? "You";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-5">
        <div className="grid size-20 place-items-center rounded-full bg-fg text-3xl font-bold text-bg">{name.charAt(0).toUpperCase()}</div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
          <p className="text-muted">{session?.email}{me.isHost ? " · Host" : ""} · Joined {new Date(me.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
        </div>
      </div>
      <ProfileForm me={me} />
    </div>
  );
}
