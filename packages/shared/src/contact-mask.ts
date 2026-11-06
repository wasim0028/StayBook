/**
 * Until a booking is confirmed, guests and hosts can't swap contact details in messages (the same rule
 * Airbnb applies): it keeps payment, refunds and support on the platform. Matching is deliberately broad.
 */
// Order matters: links first (they may contain digits), then emails, then bare phone numbers.
const PATTERNS: RegExp[] = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b(?:wa\.me|t\.me|instagram\.com|facebook\.com)\/\S+/gi,
  /[\w.+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}(?:\s*(?:\.|\sdot\s)\s*[a-z]{2,})?/gi, // incl. "name at gmail dot com"
  /(?:\+?91[\s-]*)?\d(?:[\s-]*\d){9,}/g, // 10+ digits, spaces/dashes allowed; ends on a digit
];

export const MASK = "[hidden until booked]";

export function maskContactInfo(text: string): { text: string; masked: boolean } {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return { text: out, masked: out !== text };
}
