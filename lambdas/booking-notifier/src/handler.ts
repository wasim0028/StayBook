import { AdminGetUserCommand, CognitoIdentityProviderClient, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { ddbFromEnv } from "@mp/shared";
import { handleBatch, type Directory, type Logger, type Mailer, type Pusher, type StreamRecord } from "./notifier.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const log: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: "warn", msg, ...ctx })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: "error", msg, ...ctx })),
};

const ses = new SESv2Client({});
const cognito = new CognitoIdentityProviderClient({});
// Booking emails need a verified SES sender; without one only push notifications are sent.
const from = process.env.EMAIL_FROM && process.env.EMAIL_FROM !== "unset@invalid" ? process.env.EMAIL_FROM : undefined;
const poolId = required("COGNITO_USER_POOL_ID");

const mailer: Mailer | undefined = from ? {
  async send(to, email) {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: { Text: { Data: email.text, Charset: "UTF-8" }, Html: { Data: email.html, Charset: "UTF-8" } },
          },
        },
      }),
    );
  },
} : undefined;

const directory: Directory = {
  async emailOf(userId) {
    try {
      const r = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: userId }));
      return r.UserAttributes?.find((a) => a.Name === "email")?.Value;
    } catch (e) {
      if (e instanceof UserNotFoundException) return undefined;
      throw e;
    }
  },
};

const ddb = ddbFromEnv();

/** Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/), 100 per request. */
const pusher: Pusher = {
  async send(messages) {
    const dead: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: "default", channelId: "messages" }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`expo push returned ${res.status}`);
      const out = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      out.data?.forEach((t, k) => t.status === "error" && t.details?.error === "DeviceNotRegistered" && dead.push(batch[k]!.to));
    }
    return { deadTokens: dead };
  },
};

export const handler = (event: { Records: StreamRecord[] }) => handleBatch({ ddb, mailer, pusher, directory, log }, event.Records);
