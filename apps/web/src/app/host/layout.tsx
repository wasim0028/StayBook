import { getSession } from "@/lib/api";
import { HostTabs } from "./HostTabs";

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <>
      {session?.isHost && <HostTabs />}
      {children}
    </>
  );
}
