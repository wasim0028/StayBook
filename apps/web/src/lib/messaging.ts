"use client";

import { call } from "./client-api";

/** Opens (or reuses) the conversation and goes to it. */
export async function openConversation(start: { listingId: string } | { bookingId: string }): Promise<void> {
  const { threadId } = await call<{ threadId: string }>("/v1/threads", { method: "POST", body: start });
  window.location.href = `/inbox?t=${encodeURIComponent(threadId)}`;
}

const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });

/** "10:42 am" today, "Mon" this week, "12 Oct" otherwise. */
export function shortWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return time.format(d);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return day.format(d);
}
export const clock = (iso: string) => time.format(new Date(iso));
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return full.format(d);
}
