"use client";

/** Minimal typing for Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). */
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description?: string;
  image?: string;
  prefill?: { email?: string; name?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error: { description?: string; reason?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => RazorpayInstance;
  }
}

let loading: Promise<void> | undefined;

export function loadRazorpay(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = undefined;
      reject(new Error("Could not load Razorpay. Check your connection and try again."));
    };
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Opens Checkout. Resolves "paid" when Razorpay reports success (the webhook is what actually confirms the
 * booking, so the caller still polls) and "dismissed" when the guest closes the window.
 */
export async function pay(o: { keyId: string; orderId: string; amountPaise: number; title: string; email?: string; bookingId: string }): Promise<"paid" | "dismissed"> {
  await loadRazorpay();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: o.keyId,
      order_id: o.orderId,
      amount: o.amountPaise,
      currency: "INR",
      name: "StayBook",
      description: o.title,
      prefill: { email: o.email },
      notes: { bookingId: o.bookingId },
      theme: { color: "#e5483a" },
      handler: () => resolve("paid"),
      modal: { ondismiss: () => resolve("dismissed"), confirm_close: true },
    });
    rzp.open();
  });
}
