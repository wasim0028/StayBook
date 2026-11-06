import { Award, BadgeCheck, MessageCircle, Star } from "lucide-react";
import type { HostSummary } from "@/lib/types";

/** "Hosted by …" with Airbnb-style trust signals. */
export function HostCard({ h }: { h: HostSummary }) {
  const since = h.hostingSince ? new Date(h.hostingSince).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : null;
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="relative">
        <div className="grid size-16 place-items-center rounded-full bg-fg text-2xl font-bold text-bg">{h.name.charAt(0).toUpperCase()}</div>
        {h.superhost && <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-bg bg-brand text-brand-fg" title="Superhost"><Award className="size-4" /></span>}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold">Hosted by {h.name}</h2>
        {since && <p className="text-sm text-muted">Hosting since {since}</p>}
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {h.superhost && <li className="flex items-center gap-1.5 font-medium"><Award className="size-4 text-brand" /> Superhost</li>}
          {h.identityVerified && <li className="flex items-center gap-1.5"><BadgeCheck className="size-4" /> Identity verified</li>}
          {h.reviews ? <li className="flex items-center gap-1.5"><Star className="size-4" /> {h.reviews} reviews{h.ratingAvg ? ` · ${h.ratingAvg.toFixed(2)}` : ""}</li> : null}
          {h.responseRatePct != null && <li className="flex items-center gap-1.5"><MessageCircle className="size-4" /> {h.responseRatePct}% response rate</li>}
        </ul>
        {h.superhost && <p className="mt-3 max-w-xl text-sm text-muted">Superhosts are experienced, highly rated hosts committed to great stays: 10+ stays a year, a 4.8+ rating, almost no cancellations, and quick replies.</p>}
      </div>
    </div>
  );
}
