import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./api";

/** Host pages need the "host" group in the token; everyone else goes to onboarding first. */
export async function requireHost() {
  const s = await getSession();
  if (!s) redirect("/auth/login?next=/host");
  if (!s.isHost) redirect("/host/onboarding");
  return s;
}
