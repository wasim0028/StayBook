import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const profileUpdateSchema = z
  .object({
    displayName: text(60).optional(),
    bio: z.string().trim().max(500).optional(),
    phone: z.string().regex(/^[6-9]\d{9}$/, "10-digit Indian mobile number").optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "nothing to update");

const address = z
  .object({
    street1: text(120),
    street2: z.string().trim().max(120).optional(),
    city: text(60),
    state: text(60),
    postalCode: z.string().regex(/^\d{6}$/, "6-digit PIN code"),
  })
  .strict();

export const onboardingSchema = z
  .object({
    legalBusinessName: text(120),
    businessType: z.enum([
      "individual",
      "proprietorship",
      "partnership",
      "private_limited",
      "public_limited",
      "llp",
      "trust",
      "society",
      "ngo",
    ]),
    contactName: text(80),
    email: z.string().email().max(120),
    phone: z.string().regex(/^[6-9]\d{9}$/, "10-digit Indian mobile number"),
    pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN like ABCDE1234F"),
    gstin: z
      .string()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "invalid GSTIN")
      .optional(),
    address,
    bank: z
      .object({
        accountNumber: z.string().regex(/^\d{9,18}$/, "9-18 digit account number"),
        ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC like HDFC0001234"),
        beneficiaryName: text(80),
      })
      .strict(),
  })
  .strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;
