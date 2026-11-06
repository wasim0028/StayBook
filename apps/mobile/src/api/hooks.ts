import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./client";
import type {
  Booking,
  CalendarResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  HostListing,
  Listing,
  Me,
  Page,
  Review,
  SearchResponse,
  WishlistItem,
  InboxThread,
  ThreadDetail,
  ChatMessage,
  Quote,
  GuestReviews,
} from "./types";

export interface SearchFilters {
  priceMin?: number; // rupees per night
  priceMax?: number;
  minBedrooms?: number;
  minBeds?: number;
  minBathrooms?: number;
  instantBook?: boolean;
  type?: string[];
}

export interface SearchParams extends SearchFilters {
  bbox: string; // swLat,swLng,neLat,neLng
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  /** Flexible dates: the best window of this kind in the chosen months. Ignored when checkIn is set. */
  flex?: "weekend" | "week" | "month";
  months?: string[];
}

export function countFilters(f: SearchFilters): number {
  return [f.priceMin || f.priceMax, f.minBedrooms, f.minBeds, f.minBathrooms, f.instantBook, f.type?.length].filter(Boolean).length;
}

export function useSearch(p: SearchParams | null) {
  return useQuery({
    queryKey: ["search", p],
    enabled: !!p,
    placeholderData: keepPreviousData, // keep pins on screen while the map moves
    staleTime: 30_000,
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ bbox: p!.bbox, limit: "50" });
      if (p!.checkIn && p!.checkOut) {
        qs.set("checkIn", p!.checkIn);
        qs.set("checkOut", p!.checkOut);
      }
      else if (p!.flex && p!.months?.length) {
        qs.set("flex", p!.flex);
        qs.set("months", p!.months.join(","));
      }
      if (p!.guests) qs.set("guests", String(p!.guests));
      if (p!.priceMin) qs.set("priceMin", String(p!.priceMin));
      if (p!.priceMax) qs.set("priceMax", String(p!.priceMax));
      if (p!.minBedrooms) qs.set("minBedrooms", String(p!.minBedrooms));
      if (p!.minBeds) qs.set("minBeds", String(p!.minBeds));
      if (p!.minBathrooms) qs.set("minBathrooms", String(p!.minBathrooms));
      if (p!.instantBook) qs.set("instantBook", "true");
      if (p!.type?.length) qs.set("type", p!.type.join(","));
      return api<SearchResponse>(`/v1/search?${qs}`, { signal });
    },
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: ["listing", id],
    queryFn: ({ signal }) => api<Listing>(`/v1/listings/${id}`, { signal }),
    staleTime: 60_000,
  });
}

export function useCalendar(id: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ["calendar", id, from, to],
    enabled: !!from && !!to,
    queryFn: ({ signal }) => api<CalendarResponse>(`/v1/listings/${id}/calendar?from=${from}&to=${to}`, { signal }),
    staleTime: 15_000,
  });
}

export function useCreateBooking() {
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateBookingRequest; idempotencyKey: string }) =>
      api<CreateBookingResponse>("/v1/bookings", {
        method: "POST",
        auth: true,
        body,
        headers: { "idempotency-key": idempotencyKey },
      }),
  });
}

export function fetchBooking(id: string) {
  return api<Booking>(`/v1/bookings/${id}`, { auth: true });
}

export function useTrips(enabled: boolean) {
  return useQuery({
    queryKey: ["trips"],
    enabled,
    queryFn: ({ signal }) => api<{ items: Booking[] }>("/v1/trips", { auth: true, signal }),
  });
}

// ---------- bookings ----------

export function useBooking(id: string) {
  return useQuery({
    queryKey: ["booking", id],
    queryFn: ({ signal }) => api<Booking>(`/v1/bookings/${id}`, { auth: true, signal }),
    // While the payment webhook is confirming, check every few seconds.
    refetchInterval: (q) => (q.state.data?.status === "PENDING_PAYMENT" ? 4000 : false),
  });
}

export function useCancelBooking(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Booking>(`/v1/bookings/${id}/cancel`, { method: "POST", auth: true }),
    onSuccess: (b) => {
      qc.setQueryData(["booking", id], b);
      void qc.invalidateQueries({ queryKey: ["trips"] });
      void qc.invalidateQueries({ queryKey: ["host", "reservations"] });
    },
  });
}

// ---------- reviews ----------

export function useListingReviews(listingId: string) {
  return useQuery({
    queryKey: ["reviews", listingId],
    queryFn: ({ signal }) => api<Page<Review>>(`/v1/reviews/listing/${listingId}?limit=10`, { signal }),
    staleTime: 60_000,
  });
}

/** The review attached to a booking, or null when there isn't one yet. */
export function useBookingReview(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: ["review", bookingId],
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return await api<Review>(`/v1/reviews/by-booking/${bookingId}`, { auth: true, signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useCreateReview(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rating: number; comment: string }) => api<Review>("/v1/reviews", { method: "POST", auth: true, body: { bookingId, ...body } }),
    onSuccess: (r) => qc.setQueryData(["review", bookingId], r),
  });
}

export function useReplyToReview(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<Review>(`/v1/reviews/by-booking/${bookingId}/reply`, { method: "POST", auth: true, body: { text } }),
    onSuccess: (r) => qc.setQueryData(["review", bookingId], r),
  });
}

// ---------- profile & wishlist ----------

export function useMe(enabled: boolean) {
  return useQuery({ queryKey: ["me"], enabled, queryFn: ({ signal }) => api<Me>("/v1/me", { auth: true, signal }) });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { displayName?: string; bio?: string; phone?: string }) => api<Me>("/v1/me", { method: "PUT", auth: true, body }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });
}

export function useWishlist(enabled: boolean) {
  return useQuery({
    queryKey: ["wishlist"],
    enabled,
    queryFn: ({ signal }) => api<Page<WishlistItem>>("/v1/wishlist?limit=50", { auth: true, signal }),
  });
}

/** Optimistic save/unsave; the heart flips immediately and rolls back on failure. */
export function useToggleWish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) => api<void>(`/v1/wishlist/${id}`, { method: save ? "PUT" : "DELETE", auth: true }),
    onMutate: async ({ id, save }) => {
      await qc.cancelQueries({ queryKey: ["wishlist"] });
      const prev = qc.getQueryData<Page<WishlistItem>>(["wishlist"]);
      if (prev && !save) qc.setQueryData(["wishlist"], { ...prev, items: prev.items.filter((i) => i.id !== id) });
      const ids = new Set(qc.getQueryData<string[]>(["wishlist", "ids"]) ?? prev?.items.map((i) => i.id) ?? []);
      if (save) ids.add(id);
      else ids.delete(id);
      qc.setQueryData(["wishlist", "ids"], [...ids]);
      return { prev, prevIds: [...ids] };
    },
    onError: (_e, { id, save }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["wishlist"], ctx.prev);
      const ids = new Set(qc.getQueryData<string[]>(["wishlist", "ids"]) ?? []);
      if (save) ids.delete(id);
      else ids.add(id);
      qc.setQueryData(["wishlist", "ids"], [...ids]);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["wishlist"], exact: true }),
  });
}

/** Ids of saved listings, for drawing filled hearts. */
export function useSavedIds(enabled: boolean): Set<string> {
  const qc = useQueryClient();
  const list = useWishlist(enabled);
  const override = useQuery({ queryKey: ["wishlist", "ids"], enabled: false, queryFn: () => qc.getQueryData<string[]>(["wishlist", "ids"]) ?? [] });
  return new Set(override.data ?? list.data?.items.map((i) => i.id) ?? []);
}

// ---------- hosting ----------

export function useHostReservations(enabled: boolean) {
  return useQuery({
    queryKey: ["host", "reservations"],
    enabled,
    queryFn: ({ signal }) => api<Page<Booking>>("/v1/host/reservations?limit=50", { auth: true, signal }),
  });
}

export function useHostListings(enabled: boolean) {
  return useQuery({
    queryKey: ["host", "listings"],
    enabled,
    queryFn: ({ signal }) => api<Page<HostListing>>("/v1/host/listings?limit=50", { auth: true, signal }),
  });
}

export function useSetPublished() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => api<HostListing>(`/v1/listings/${id}/${publish ? "publish" : "unpublish"}`, { method: "POST", auth: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["host", "listings"] }),
  });
}

export interface OnboardingInput {
  legalBusinessName: string;
  businessType: string;
  contactName: string;
  email: string;
  phone: string;
  pan: string;
  gstin?: string;
  address: { street1: string; street2?: string; city: string; state: string; postalCode: string };
  bank: { accountNumber: string; ifsc: string; beneficiaryName: string };
}

export function useOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OnboardingInput) => api<Me>("/v1/host/onboarding", { method: "POST", auth: true, body, timeoutMs: 45_000 }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });
}

export function useRefreshPayoutStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Me>("/v1/host/onboarding?refresh=true", { auth: true }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });
}

// ---------- messaging ----------

/** Unread total for the tab badge. Polls while the app is open; push covers the rest. */
export function useInboxSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["inbox", "summary"],
    enabled,
    refetchInterval: 15_000,
    queryFn: ({ signal }) => api<{ unread: number; version: number }>("/v1/inbox/summary", { auth: true, signal }),
  });
}

export function useThreads(enabled: boolean, version?: number) {
  return useQuery({
    queryKey: ["inbox", "threads", version],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api<Page<InboxThread>>("/v1/threads?limit=50", { auth: true, signal }),
  });
}

export function useThreadDetail(id: string) {
  return useQuery({ queryKey: ["thread", id], queryFn: ({ signal }) => api<ThreadDetail>(`/v1/threads/${encodeURIComponent(id)}`, { auth: true, signal }) });
}

export const fetchMessages = (id: string, q: string) => api<Page<ChatMessage>>(`/v1/threads/${encodeURIComponent(id)}/messages${q}`, { auth: true });
export const postMessage = (id: string, body: string, clientId: string) => api<ChatMessage>(`/v1/threads/${encodeURIComponent(id)}/messages`, { method: "POST", auth: true, body: { body, clientId } });
export const markThreadRead = (id: string) => api<void>(`/v1/threads/${encodeURIComponent(id)}/read`, { method: "POST", auth: true });
export const startThread = (start: { listingId: string } | { bookingId: string }) => api<{ threadId: string }>("/v1/threads", { method: "POST", auth: true, body: start });

// ---------- pricing & booking requests ----------

/** The exact price the guest will be charged (fees, discounts, GST). Errors carry MIN_NIGHTS etc. */
export function useQuote(listingId: string, checkIn?: string, checkOut?: string, guests = 1) {
  return useQuery({
    queryKey: ["quote", listingId, checkIn, checkOut, guests],
    enabled: !!checkIn && !!checkOut,
    staleTime: 15_000,
    retry: false,
    queryFn: ({ signal }) => api<Quote>(`/v1/quote?${new URLSearchParams({ listingId, checkIn: checkIn!, checkOut: checkOut!, guests: String(guests) })}`, { signal }),
  });
}

export function useAnswerRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, reason }: { kind: "accept" | "decline"; reason?: string }) => api<Booking>(`/v1/bookings/${id}/${kind}`, { method: "POST", auth: true, body: kind === "decline" && reason ? { reason } : undefined }),
    onSuccess: (b) => {
      qc.setQueryData(["booking", id], b);
      void qc.invalidateQueries({ queryKey: ["host", "reservations"] });
    },
  });
}

export function useGuestReviews(guestId: string | undefined) {
  return useQuery({
    queryKey: ["guest-reviews", guestId],
    enabled: !!guestId,
    queryFn: async ({ signal }) => {
      try {
        return await api<GuestReviews>(`/v1/reviews/guests/${guestId}?limit=5`, { auth: true, signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useReviewGuest(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { rating: number; comment: string }) => api<{ rating: number }>("/v1/reviews/guests", { method: "POST", auth: true, body: { bookingId, ...body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["guest-reviews"] }),
  });
}

// ---------- places ----------

export interface Place {
  name: string;
  state: string;
  lat: number;
  lng: number;
  bbox: string;
}

export function usePlaces(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["places", term.toLowerCase()],
    enabled: term.length >= 2,
    staleTime: 24 * 3600_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api<{ items: Place[]; attribution: string }>(`/v1/places?q=${encodeURIComponent(term)}`, { signal }),
  });
}
