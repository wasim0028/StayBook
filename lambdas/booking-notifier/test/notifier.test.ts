import { marshall } from "@aws-sdk/util-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb } from "@mp/test-utils";
import { handleBatch, kindOf, messageOf, notify, type Deps, type PushMessage, type StreamRecord } from "../src/notifier.js";
import { inr, prettyDate } from "../src/templates.js";
import type { Email } from "../src/templates.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
const sent: { to: string; email: Email }[] = [];
let failSend = false;
const emails: Record<string, string | undefined> = { guest1: "guest@example.in", host1: "host@example.in" };

const deps = (): Deps => ({
  ddb: db,
  mailer: {
    async send(to, email) {
      if (failSend) throw new Error("ses throttled");
      sent.push({ to, email });
    },
  },
  directory: { emailOf: async (id) => emails[id] },
  log: { info() {}, warn() {}, error() {} },
});

const booking = (status: string, extra: Record<string, unknown> = {}) => ({
  PK: "BOOKING#abcdef12-0000-4000-8000-000000000000",
  SK: "META",
  bookingId: "abcdef12-0000-4000-8000-000000000000",
  listingId: "l1",
  guestId: "guest1",
  hostId: "host1",
  listingTitle: "Sea <View> Villa",
  checkIn: "2026-12-20",
  checkOut: "2026-12-23",
  guests: 2,
  totalPaise: 1_234_500,
  hostPayoutPaise: 1_086_360,
  status,
  ...extra,
});

let seq = 0;
const rec = (eventName: string, oldB: object | undefined, newB: object | undefined): StreamRecord => ({
  eventName,
  dynamodb: {
    SequenceNumber: String(++seq),
    OldImage: oldB ? (marshall(oldB) as any) : undefined,
    NewImage: newB ? (marshall(newB) as any) : undefined,
  },
});

beforeAll(async () => {
  db = await startTestDb();
}, 30_000);
afterAll(async () => db?.stop());
beforeEach(() => {
  sent.length = 0;
  failSend = false;
});

describe("kindOf", () => {
  it("fires only on a status change into CONFIRMED or out of CONFIRMED into CANCELLED", () => {
    expect(kindOf(rec("MODIFY", booking("PENDING_PAYMENT"), booking("CONFIRMED")))?.kind).toBe("CONFIRMED");
    expect(kindOf(rec("MODIFY", booking("CONFIRMED"), booking("CANCELLED")))?.kind).toBe("CANCELLED");
    expect(kindOf(rec("MODIFY", booking("PENDING_PAYMENT"), booking("CANCELLED")))).toBeUndefined();
    expect(kindOf(rec("MODIFY", booking("CONFIRMED"), booking("CONFIRMED", { refundStatus: "PROCESSED" })))).toBeUndefined();
    expect(kindOf(rec("INSERT", undefined, booking("CONFIRMED")))).toBeUndefined();
    expect(kindOf(rec("MODIFY", { PK: "LISTING#1", SK: "META", status: "A" }, { PK: "LISTING#1", SK: "META", status: "CONFIRMED" }))).toBeUndefined();
  });
});

describe("notifications", () => {
  it("emails guest and host once on confirmation, escaping user text", async () => {
    const r = rec("MODIFY", booking("PENDING_PAYMENT"), booking("CONFIRMED"));
    expect(await handleBatch(deps(), [r])).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.to).sort()).toEqual(["guest@example.in", "host@example.in"]);

    const g = sent.find((s) => s.to === "guest@example.in")!.email;
    expect(g.subject).toContain("Sea <View> Villa");
    expect(g.html).toContain("Sea &lt;View&gt; Villa");
    expect(g.html).not.toContain("<View>");
    expect(g.text).toContain("₹12,345");
    const h = sent.find((s) => s.to === "host@example.in")!.email;
    expect(h.text).toContain("₹10,863.60");
  });

  it("does not resend when the stream redelivers the same change", async () => {
    const r = rec("MODIFY", booking("PENDING_PAYMENT"), booking("CONFIRMED"));
    await handleBatch(deps(), [r]);
    sent.length = 0;
    await handleBatch(deps(), [r, r]);
    expect(sent).toEqual([]);
  });

  it("sends cancellation emails with the refund amount", async () => {
    const r = rec("MODIFY", booking("CONFIRMED"), booking("CANCELLED", { cancelledBy: "host", refundPaise: 1_234_500 }));
    await handleBatch(deps(), [r]);
    const g = sent.find((s) => s.to === "guest@example.in")!.email;
    expect(g.text).toContain("cancelled by the host");
    expect(g.text).toContain("₹12,345");
  });

  it("on a send failure reports that record and everything after it, and releases the claim so a retry sends", async () => {
    const a = rec("MODIFY", booking("PENDING_PAYMENT", { bookingId: "aaaaaaaa-0000-4000-8000-000000000001", PK: "BOOKING#aaaaaaaa-0000-4000-8000-000000000001" }), booking("CONFIRMED", { bookingId: "aaaaaaaa-0000-4000-8000-000000000001", PK: "BOOKING#aaaaaaaa-0000-4000-8000-000000000001" }));
    const b = rec("MODIFY", booking("PENDING_PAYMENT", { bookingId: "bbbbbbbb-0000-4000-8000-000000000002", PK: "BOOKING#bbbbbbbb-0000-4000-8000-000000000002" }), booking("CONFIRMED", { bookingId: "bbbbbbbb-0000-4000-8000-000000000002", PK: "BOOKING#bbbbbbbb-0000-4000-8000-000000000002" }));
    failSend = true;
    const r = await handleBatch(deps(), [a, b]);
    expect(r.batchItemFailures.map((f) => f.itemIdentifier)).toEqual([a.dynamodb!.SequenceNumber, b.dynamodb!.SequenceNumber]);
    const claim = await db.doc.send(new GetCommand({ TableName: db.table, Key: { PK: "NOTIF#aaaaaaaa-0000-4000-8000-000000000001#CONFIRMED#guest", SK: "META" } }));
    expect(claim.Item).toBeUndefined();

    failSend = false;
    expect(await handleBatch(deps(), [a, b])).toEqual({ batchItemFailures: [] });
    expect(sent).toHaveLength(4);
  });

  it("skips a recipient with no email but still notifies the other side", async () => {
    emails.guest1 = undefined;
    const r = rec("MODIFY", booking("PENDING_PAYMENT", { bookingId: "cccccccc-0000-4000-8000-000000000003", PK: "BOOKING#cccccccc-0000-4000-8000-000000000003" }), booking("CONFIRMED", { bookingId: "cccccccc-0000-4000-8000-000000000003", PK: "BOOKING#cccccccc-0000-4000-8000-000000000003" }));
    expect(await handleBatch(deps(), [r])).toEqual({ batchItemFailures: [] });
    expect(sent.map((s) => s.to)).toEqual(["host@example.in"]);
    emails.guest1 = "guest@example.in";
  });
});

describe("formatting", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(100)).toBe("₹1");
    expect(inr(99_900)).toBe("₹999");
    expect(inr(1_000_00)).toBe("₹1,000");
    expect(inr(12_34_567_89)).toBe("₹12,34,567.89");
    expect(inr(5)).toBe("₹0.05");
    expect(prettyDate("2026-12-03")).toBe("3 Dec 2026");
  });
});

describe("chat push notifications", () => {
  const pushed: PushMessage[][] = [];
  let dead: string[] = [];
  const pdeps = (): Deps => ({ ...deps(), pusher: { async send(m) { pushed.push(m); return { deadTokens: dead }; } } });
  const msgRec = (id: string, seq: string, recipientId = "host1"): StreamRecord => ({
    eventName: "INSERT",
    dynamodb: {
      SequenceNumber: seq,
      NewImage: marshall({ PK: "THREAD#t1", SK: `MSG#2026-11-01T00:00:00.000Z#${id}`, threadId: "t1", messageId: id, senderId: "guest1", senderName: "Ravi", recipientId, body: "Is parking available? ".repeat(10) }),
    },
  });
  const token = (user: string, t: string) => db.doc.send(new PutCommand({ TableName: db.table, Item: { PK: `USER#${user}`, SK: `PUSH#${t}`, token: t } }));

  it("recognises only newly posted messages", () => {
    expect(messageOf(msgRec("m0", "1"))).toMatchObject({ recipientId: "host1", senderName: "Ravi" });
    expect(messageOf({ ...msgRec("m0", "1"), eventName: "MODIFY" })).toBeUndefined();
  });

  it("pushes to every device of the recipient once, trimming long text", async () => {
    await token("host1", "ExponentPushToken[a]");
    await token("host1", "ExponentPushToken[b]");
    pushed.length = 0;
    expect(await notify(pdeps(), msgRec("m1", "11"))).toBe(2);
    expect(await notify(pdeps(), msgRec("m1", "11"))).toBe(0); // redelivered
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.map((p) => p.to).sort()).toEqual(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    expect(pushed[0]![0]).toMatchObject({ title: "Ravi", data: { type: "message", threadId: "t1" } });
    expect(pushed[0]![0]!.body.length).toBeLessThanOrEqual(140);
  });

  it("forgets devices Expo reports as unregistered", async () => {
    dead = ["ExponentPushToken[b]"];
    await notify(pdeps(), msgRec("m2", "12"));
    dead = [];
    const gone = await db.doc.send(new GetCommand({ TableName: db.table, Key: { PK: "USER#host1", SK: "PUSH#ExponentPushToken[b]" } }));
    expect(gone.Item).toBeUndefined();
  });

  it("does nothing for users without the app, and skips booking emails when no sender is set", async () => {
    pushed.length = 0;
    expect(await notify(pdeps(), msgRec("m3", "13", "nobody"))).toBe(0);
    expect(pushed).toHaveLength(0);
    const noMail: Deps = { ...pdeps(), mailer: undefined };
    const rec: StreamRecord = { eventName: "MODIFY", dynamodb: { SequenceNumber: "14", OldImage: marshall(booking("PENDING_PAYMENT")), NewImage: marshall(booking("CONFIRMED", { bookingId: "nomail-0000-4000-8000-000000000000", PK: "BOOKING#nomail" })) } };
    expect(await notify(noMail, rec)).toBe(0);
  });
});

describe("request to book emails", () => {
  beforeEach(() => (sent.length = 0));
  const rec = (old: object | undefined, now: object, seq: string, eventName = "MODIFY"): StreamRecord => ({ eventName, dynamodb: { SequenceNumber: seq, OldImage: old ? marshall(old) : undefined, NewImage: marshall(now) } });
  const req = (status: string, extra: Record<string, unknown> = {}) => booking(status, { bookingId: "req00000-0000-4000-8000-000000000000", PK: "BOOKING#req", requestMessage: "Two of us, quiet couple", ...extra });

  it("tells the host about a new request, with the guest's message", async () => {
    await handleBatch(deps(), [rec(undefined, req("REQUESTED"), "r1", "INSERT")]);
    expect(sent.map((s) => s.to)).toEqual(["host@example.in"]);
    expect(sent[0]!.email.subject).toMatch(/^Booking request/);
    expect(sent[0]!.email.text).toContain("Two of us, quiet couple");
  });

  it("tells the guest when the host accepts or declines, and says if it simply expired", async () => {
    await handleBatch(deps(), [rec(req("REQUESTED"), req("PENDING_PAYMENT"), "r2")]);
    expect(sent.map((s) => [s.to, s.email.subject.split(":")[0]])).toEqual([["guest@example.in", "Accepted! Complete your booking"]]);
    sent.length = 0;
    await handleBatch(deps(), [rec(req("REQUESTED"), req("DECLINED", { bookingId: "req00000-0000-4000-8000-000000000001", expiredReason: "REQUEST_NOT_ANSWERED" }), "r3")]);
    expect(sent[0]!.email.subject).toMatch(/expired/);
  });

  it("ignores newly created instant bookings (only the payment confirms them)", async () => {
    await handleBatch(deps(), [rec(undefined, booking("PENDING_PAYMENT"), "r4", "INSERT")]);
    expect(sent).toHaveLength(0);
  });
});
