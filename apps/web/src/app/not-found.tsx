import { Compass } from "lucide-react";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-brand-soft text-brand"><Compass className="size-8" /></div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">We can&apos;t find that page</h1>
      <p className="mt-2 text-muted">It may have been unlisted or the link is wrong.</p>
      <LinkButton href="/" className="mt-8">Back to home</LinkButton>
    </div>
  );
}
