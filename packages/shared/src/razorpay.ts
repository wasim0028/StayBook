import { createHmac, timingSafeEqual } from "node:crypto";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * Minimal Razorpay REST client (orders with Route transfers, refunds, transfer reversals).
 * Plain fetch keeps Lambda bundles small and avoids SDK method-name churn.
 * API reference: https://razorpay.com/docs/api/  (verify field names against it before go-live)
 */

export class RazorpayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export interface CreateOrderInput {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
  transfer: {
    account: string; // linked account acc_xxx
    amountPaise: number;
    onHoldUntil: number; // epoch seconds
    notes: Record<string, string>;
  };
}

export interface RazorpayApi {
  createOrder(input: CreateOrderInput): Promise<{ id: string; amount: number }>;
  refund(
    paymentId: string,
    input: { amountPaise: number; reverseAll: boolean; receipt: string; notes: Record<string, string> },
  ): Promise<{ id: string; status: string }>;
  paymentTransfers(paymentId: string): Promise<{ id: string; amount: number; recipient: string }[]>;
  reverseTransfer(transferId: string, amountPaise: number): Promise<{ id: string }>;
}

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

/** Authenticated JSON caller shared by the orders client and the Route accounts client. */
export function razorpayCaller(
  creds: RazorpayCredentials,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
) {
  const base = opts.baseUrl ?? "https://api.razorpay.com";
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;

  return async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: auth, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (e) {
      throw new RazorpayError(0, "NETWORK", `razorpay unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; description?: string } }).error;
      throw new RazorpayError(res.status, err?.code ?? "HTTP_ERROR", err?.description ?? `razorpay ${res.status}`);
    }
    return data as T;
  };
}

export function httpRazorpay(
  creds: RazorpayCredentials,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): RazorpayApi {
  // Orders, payments and refunds live under /v1; `baseUrl` is the host only.
  const callRoot = razorpayCaller(creds, opts);
  const prefix = "/v1";
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) => callRoot<T>(method, `${prefix}${path}`, body);

  return {
    createOrder: (i) =>
      call("POST", "/orders", {
        amount: i.amountPaise,
        currency: "INR",
        receipt: i.receipt,
        notes: i.notes,
        transfers: [
          {
            account: i.transfer.account,
            amount: i.transfer.amountPaise,
            currency: "INR",
            notes: i.transfer.notes,
            on_hold: true,
            on_hold_until: i.transfer.onHoldUntil,
          },
        ],
      }),
    refund: (paymentId, i) =>
      call("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
        amount: i.amountPaise,
        speed: "normal",
        receipt: i.receipt,
        notes: i.notes,
        ...(i.reverseAll ? { reverse_all: true } : {}),
      }),
    paymentTransfers: async (paymentId) =>
      (await call<{ items: { id: string; amount: number; recipient: string }[] }>("GET", `/payments/${encodeURIComponent(paymentId)}/transfers`)).items,
    reverseTransfer: (transferId, amountPaise) =>
      call("POST", `/transfers/${encodeURIComponent(transferId)}/reversals`, { amount: amountPaise }),
  };
}

/** Razorpay signs webhooks with HMAC-SHA256 over the exact raw body, hex-encoded. */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Credentials from Secrets Manager (JSON: {"key_id","key_secret","webhook_secret"}) when RAZORPAY_SECRET_ID
 * is set, else from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET (local dev only).
 */
export async function loadRazorpayCredentials(sm = new SecretsManagerClient({})): Promise<RazorpayCredentials> {
  const secretId = process.env.RAZORPAY_SECRET_ID;
  if (secretId) {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    const v = JSON.parse(r.SecretString ?? "{}") as { key_id?: string; key_secret?: string; webhook_secret?: string };
    if (!v.key_id || !v.key_secret) throw new Error(`secret ${secretId} must contain key_id and key_secret`);
    return { keyId: v.key_id, keySecret: v.key_secret, webhookSecret: v.webhook_secret };
  }
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("set RAZORPAY_SECRET_ID, or RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET");
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET };
}
