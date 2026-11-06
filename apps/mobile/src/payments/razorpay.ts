import { NativeModules, TurboModuleRegistry } from "react-native";

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number; // paise; must equal the order amount
  currency: "INR";
  name: string;
  description?: string;
  prefill?: { email?: string; contact?: string; name?: string };
  theme?: { color?: string };
}

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type CheckoutResult =
  | { ok: true; payment: RazorpaySuccess }
  | { ok: false; cancelled: boolean; message: string };

/** Razorpay is a native module: it needs a dev/production build (`npx expo run:*` or EAS), not Expo Go. */
export function isRazorpayAvailable(): boolean {
  return !!(NativeModules.RNRazorpayCheckout ?? TurboModuleRegistry.get("RNRazorpayCheckout"));
}

/**
 * Opens Razorpay Checkout. The result here is only a UX signal: the booking is confirmed by the
 * server when the payment.captured webhook arrives, so callers must poll the booking afterwards.
 */
export async function openCheckout(options: RazorpayOptions): Promise<CheckoutResult> {
  if (!isRazorpayAvailable()) {
    return { ok: false, cancelled: false, message: "Payments need the full app build (not Expo Go)." };
  }
  // Lazy require: the module builds a NativeEventEmitter at import time, which throws without the native side.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RazorpayCheckout = require("react-native-razorpay").default as {
    open(o: RazorpayOptions): Promise<RazorpaySuccess>;
  };
  try {
    const payment = await RazorpayCheckout.open(options);
    return { ok: true, payment };
  } catch (e) {
    const err = e as { code?: number; description?: string; error?: { description?: string } };
    // code 0 / 2 = user closed the sheet or pressed back (Razorpay SDK convention)
    const cancelled = err.code === 0 || err.code === 2;
    let message = err.error?.description ?? err.description ?? "Payment failed";
    try {
      const parsed = JSON.parse(String(err.description)) as { error?: { description?: string } };
      message = parsed.error?.description ?? message;
    } catch {
      /* description was plain text */
    }
    return { ok: false, cancelled, message: cancelled ? "Payment cancelled" : message };
  }
}
