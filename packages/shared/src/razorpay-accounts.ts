import { razorpayCaller, type RazorpayCredentials } from "./razorpay.js";

/**
 * Razorpay Route linked-account onboarding (v2 Accounts API): create the account, add the owner as
 * stakeholder, request the Route product, then attach the settlement bank account.
 * Reference: https://razorpay.com/docs/payments/route/  (verify field names in test mode before go-live)
 *
 * PAN and bank details pass through to Razorpay and are never stored by us.
 */

export type RazorpayAccountStatus =
  | "created"
  | "needs_clarification"
  | "under_review"
  | "activated"
  | "suspended"
  | "rejected";

export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export type BusinessType =
  | "individual"
  | "proprietorship"
  | "partnership"
  | "private_limited"
  | "public_limited"
  | "llp"
  | "trust"
  | "society"
  | "ngo";

export interface CreateLinkedAccountInput {
  /** Our user id, stored as reference_id so a retried onboarding can't create a second account. */
  referenceId: string;
  email: string;
  phone: string;
  legalBusinessName: string;
  businessType: BusinessType;
  contactName: string;
  pan: string;
  gstin?: string;
  address: Address;
}

export interface RazorpayAccounts {
  createAccount(i: CreateLinkedAccountInput): Promise<{ id: string; status: string }>;
  addStakeholder(accountId: string, i: { name: string; email: string; phone: string; pan: string; address: Address }): Promise<{ id: string }>;
  requestRouteProduct(accountId: string): Promise<{ id: string; activationStatus: string }>;
  setSettlement(
    accountId: string,
    productId: string,
    i: { accountNumber: string; ifsc: string; beneficiaryName: string },
  ): Promise<{ activationStatus: string }>;
  getAccount(accountId: string): Promise<{ id: string; status: RazorpayAccountStatus | string }>;
}

const addr = (a: Address) => ({
  street1: a.street1,
  street2: a.street2 ?? a.street1,
  city: a.city,
  state: a.state,
  postal_code: a.postalCode,
  country: "IN",
});

export function httpRazorpayAccounts(
  creds: RazorpayCredentials,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): RazorpayAccounts {
  const call = razorpayCaller(creds, opts);
  return {
    async createAccount(i) {
      const r = await call<{ id: string; status: string }>("POST", "/v2/accounts", {
        email: i.email,
        phone: i.phone,
        type: "route",
        reference_id: i.referenceId,
        legal_business_name: i.legalBusinessName,
        business_type: i.businessType,
        contact_name: i.contactName,
        profile: {
          category: "ecommerce",
          subcategory: "marketplace",
          addresses: { registered: addr(i.address) },
        },
        legal_info: { pan: i.pan, ...(i.gstin ? { gst: i.gstin } : {}) },
      });
      return { id: r.id, status: r.status };
    },
    async addStakeholder(accountId, i) {
      const r = await call<{ id: string }>("POST", `/v2/accounts/${encodeURIComponent(accountId)}/stakeholders`, {
        name: i.name,
        email: i.email,
        phone: { primary: i.phone },
        relationship: { executive: true },
        addresses: { residential: addr(i.address) },
        kyc: { pan: i.pan },
      });
      return { id: r.id };
    },
    async requestRouteProduct(accountId) {
      const r = await call<{ id: string; activation_status: string }>(
        "POST",
        `/v2/accounts/${encodeURIComponent(accountId)}/products`,
        { product_name: "route", tnc_accepted: true },
      );
      return { id: r.id, activationStatus: r.activation_status };
    },
    async setSettlement(accountId, productId, i) {
      const r = await call<{ activation_status: string }>(
        "PATCH",
        `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`,
        {
          settlements: { account_number: i.accountNumber, ifsc_code: i.ifsc, beneficiary_name: i.beneficiaryName },
          tnc_accepted: true,
        },
      );
      return { activationStatus: r.activation_status };
    },
    async getAccount(accountId) {
      const r = await call<{ id: string; status: string }>("GET", `/v2/accounts/${encodeURIComponent(accountId)}`);
      return { id: r.id, status: r.status };
    },
  };
}

/** Maps Razorpay's account/product status strings onto the profile statuses listing-svc and booking-svc understand. */
export function normalizeAccountStatus(s: string | undefined): RazorpayAccountStatus | undefined {
  switch (s) {
    case "created":
    case "needs_clarification":
    case "under_review":
    case "activated":
    case "suspended":
    case "rejected":
      return s;
    default:
      return undefined;
  }
}
