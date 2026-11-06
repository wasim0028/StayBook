import { Heart, Luggage } from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/api";
import { buttonClass } from "./button-class";
import { UserMenu } from "./UserMenu";
import { InboxBadge } from "./inbox/InboxBadge";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-xl font-extrabold tracking-tight text-brand ${className}`}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <path d="M16 3 3 14.5V28h8.5v-8.5h9V28H29V14.5z" fill="currentColor" />
      </svg>
      StayBook
    </span>
  );
}

export async function Navbar() {
  const session = await getSession();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="StayBook home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          {(session?.isAdmin || session?.isAnalyst) && (
            <Link href="/admin" className="hidden rounded-full px-4 py-2 text-sm font-semibold hover:bg-surface-2 sm:block">
              {session.isAdmin ? "Admin" : "Insights"}
            </Link>
          )}
          {session?.isHost ? (
            <Link href="/host" className="hidden rounded-full px-4 py-2 text-sm font-semibold hover:bg-surface-2 sm:block">
              Host dashboard
            </Link>
          ) : (
            <Link href="/host/onboarding" prefetch={false} className="hidden rounded-full px-4 py-2 text-sm font-semibold hover:bg-surface-2 sm:block">
              Become a host
            </Link>
          )}
          {session ? (
            <>
              <Link href="/wishlist" aria-label="Wishlist" className="grid size-10 place-items-center rounded-full hover:bg-surface-2">
                <Heart className="size-5" />
              </Link>
              <InboxBadge />
              <Link href="/trips" aria-label="Trips" className="grid size-10 place-items-center rounded-full hover:bg-surface-2">
                <Luggage className="size-5" />
              </Link>
              <UserMenu name={session.name} email={session.email} isHost={session.isHost} />
            </>
          ) : (
            <>
              {/* Plain links: prefetching an auth route would start a sign-in (and replace the PKCE cookie). */}
              <a href="/auth/login" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-surface-2">
                Log in
              </a>
              <a href="/auth/login?mode=signup" className={buttonClass("primary", "sm")}>
                Sign up
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-muted">Find homes, villas and homestays across India, and host your own space. Payments by Razorpay; hosts are paid 24 hours after check-out.</p>
        </div>
        <div className="text-sm">
          <h4 className="mb-3 font-semibold">Explore</h4>
          <ul className="space-y-2 text-muted">
            <li><Link href="/search?dest=goa" className="hover:text-fg">Goa</Link></li>
            <li><Link href="/search?dest=jaipur" className="hover:text-fg">Jaipur</Link></li>
            <li><Link href="/search?dest=manali" className="hover:text-fg">Manali</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <h4 className="mb-3 font-semibold">Hosting</h4>
          <ul className="space-y-2 text-muted">
            <li><Link href="/host/onboarding" prefetch={false} className="hover:text-fg">List your space</Link></li>
            <li><Link href="/host" prefetch={false} className="hover:text-fg">Host dashboard</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center text-xs text-muted">© {new Date().getFullYear()} StayBook. All rights reserved.</div>
    </footer>
  );
}

