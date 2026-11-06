import { randomUUID } from "node:crypto";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";
import {
  decodeCursor,
  eachNight,
  encodeCursor,
  geoGsiKeys,
  GSI,
  hostGsiKeys,
  HttpError,
  isConditionalFailure,
  listingKey,
  nightKey,
  nightSk,
  nightTtl,
  userKey,
  type DdbContext,
  type HostProfile,
  type Listing,
  type Night,
} from "@mp/shared";
import type { z } from "zod";
import type { calendarUpdateSchema, createListingSchema, updateListingSchema } from "./schemas.js";

type CreateInput = z.infer<typeof createListingSchema>;
type UpdateInput = z.infer<typeof updateListingSchema>;
type CalendarUpdate = z.infer<typeof calendarUpdateSchema>;

export const MAX_PHOTOS = 30;
const MAX_CALENDAR_WRITE_NIGHTS = 180;
const CALENDAR_WRITE_CONCURRENCY = 10;

/** Fields stripped before returning a listing to clients. */
const INTERNAL = ["PK", "SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK", "entity"] as const;

export function toListing(item: Record<string, NativeAttributeValue>): Listing {
  const out = { ...item };
  for (const k of INTERNAL) delete out[k];
  return out as Listing;
}

export class ListingRepo {
  constructor(private readonly ctx: DdbContext) {}

  private get t() {
    return this.ctx.table;
  }

  async get(id: string): Promise<Listing | undefined> {
    const r = await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: listingKey(id) }));
    return r.Item ? toListing(r.Item) : undefined;
  }

  async create(hostId: string, input: CreateInput): Promise<Listing> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const listing: Listing = {
      id,
      hostId,
      ...input,
      propertyType: input.propertyType as Listing["propertyType"],
      currency: "INR",
      photos: [],
      status: "DRAFT",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.ctx.doc.send(
      new PutCommand({
        TableName: this.t,
        Item: { ...listingKey(id), entity: "Listing", ...hostGsiKeys(hostId, id), ...listing },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return listing;
  }

  /**
   * Partial update with optimistic concurrency (`version`). If the listing is published and
   * location or price changed, the GSI3 geo/price keys move with it.
   */
  async update(current: Listing, input: UpdateInput): Promise<Listing> {
    const { version, ...fields } = input;
    if (version !== current.version) throw new HttpError(409, "VERSION_CONFLICT", "listing was modified; reload and retry");

    const merged = { ...current, ...fields } as Listing;
    const sets: string[] = [];
    const names: Record<string, string> = { "#version": "version", "#updatedAt": "updatedAt" };
    const values: Record<string, NativeAttributeValue> = {
      ":expected": version,
      ":one": 1,
      ":now": new Date().toISOString(),
    };

    Object.entries(fields).forEach(([k, v], i) => {
      names[`#f${i}`] = k;
      values[`:f${i}`] = v;
      sets.push(`#f${i} = :f${i}`);
    });

    if (current.status === "PUBLISHED") {
      const geo = geoGsiKeys(merged.lat, merged.lng, merged.basePricePaise, merged.id);
      names["#g3pk"] = "GSI3PK";
      names["#g3sk"] = "GSI3SK";
      values[":g3pk"] = geo.GSI3PK;
      values[":g3sk"] = geo.GSI3SK;
      sets.push("#g3pk = :g3pk", "#g3sk = :g3sk");
    }

    try {
      const r = await this.ctx.doc.send(
        new UpdateCommand({
          TableName: this.t,
          Key: listingKey(current.id),
          UpdateExpression: `SET ${sets.join(", ")}, #updatedAt = :now, #version = #version + :one`,
          ConditionExpression: "#version = :expected",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return toListing(r.Attributes!);
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "VERSION_CONFLICT", "listing was modified; reload and retry");
      throw e;
    }
  }

  async hostProfile(hostId: string): Promise<HostProfile | undefined> {
    const r = await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: userKey(hostId) }));
    return r.Item as HostProfile | undefined;
  }

  /** DRAFT -> PUBLISHED. Writing the GSI3 keys is what makes the listing searchable (sparse index). */
  async publish(l: Listing): Promise<Listing> {
    const geo = geoGsiKeys(l.lat, l.lng, l.basePricePaise, l.id);
    return this.setStatus(l, "PUBLISHED", ["DRAFT"], "SET GSI3PK = :g3pk, GSI3SK = :g3sk, coverPhotoId = :cover", {
      ":g3pk": geo.GSI3PK,
      ":g3sk": geo.GSI3SK,
      ":cover": l.photos[0],
    });
  }

  /** Removing the GSI3 keys drops the listing out of search immediately. */
  async unpublish(l: Listing, to: "DRAFT" | "SUSPENDED", from: Listing["status"][]): Promise<Listing> {
    return this.setStatus(l, to, from, "REMOVE GSI3PK, GSI3SK");
  }

  private async setStatus(
    l: Listing,
    to: Listing["status"],
    from: Listing["status"][],
    extra: string,
    extraValues: Record<string, NativeAttributeValue> = {},
  ): Promise<Listing> {
    const fromKeys = from.map((_, i) => `:from${i}`);
    const values: Record<string, NativeAttributeValue> = {
      ":to": to,
      ":now": new Date().toISOString(),
      ":one": 1,
      ...extraValues,
    };
    from.forEach((s, i) => (values[`:from${i}`] = s));

    // DynamoDB allows only one SET and one REMOVE clause, so merge the extra SET into ours.
    const [extraSet, extraRemove] = extra.startsWith("SET ")
      ? [`, ${extra.slice(4)}`, ""]
      : ["", ` ${extra}`];

    try {
      const r = await this.ctx.doc.send(
        new UpdateCommand({
          TableName: this.t,
          Key: listingKey(l.id),
          UpdateExpression: `SET #s = :to, updatedAt = :now, #v = #v + :one${extraSet}${extraRemove}`,
          ConditionExpression: `#s IN (${fromKeys.join(", ")})`,
          ExpressionAttributeNames: { "#s": "status", "#v": "version" },
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return toListing(r.Attributes!);
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "INVALID_STATE", `cannot move from ${l.status} to ${to}`);
      throw e;
    }
  }

  async listByHost(hostId: string, limit: number, cursor?: string) {
    const r = await this.ctx.doc.send(
      new QueryCommand({
        TableName: this.t,
        IndexName: GSI.hostItems,
        KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :sk)",
        ExpressionAttributeValues: { ":pk": `HOST#${hostId}`, ":sk": "LISTING#" },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []).map(toListing), nextCursor: encodeCursor(r.LastEvaluatedKey) };
  }

  /** Append a photo id. Guards: listing version unchanged by others is not required, but max count and duplicates are. */
  async attachPhoto(id: string, photoId: string): Promise<Listing> {
    try {
      const r = await this.ctx.doc.send(
        new UpdateCommand({
          TableName: this.t,
          Key: listingKey(id),
          UpdateExpression:
            "SET photos = list_append(photos, :p), coverPhotoId = if_not_exists(coverPhotoId, :pid), updatedAt = :now, #v = #v + :one",
          ConditionExpression: "attribute_exists(PK) AND size(photos) < :max AND NOT contains(photos, :pid)",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: {
            ":p": [photoId],
            ":pid": photoId,
            ":max": MAX_PHOTOS,
            ":now": new Date().toISOString(),
            ":one": 1,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return toListing(r.Attributes!);
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "PHOTO_REJECTED", `photo already attached or limit of ${MAX_PHOTOS} reached`);
      throw e;
    }
  }

  /** Reorder or remove photos. The new list must be a subset of the current one. */
  async setPhotos(current: Listing, photos: string[], version: number): Promise<Listing> {
    const existing = new Set(current.photos);
    if (!photos.every((p) => existing.has(p))) throw new HttpError(400, "UNKNOWN_PHOTO", "photos must already be attached");
    if (new Set(photos).size !== photos.length) throw new HttpError(400, "DUPLICATE_PHOTO", "duplicate photo ids");
    if (current.status === "PUBLISHED" && photos.length === 0) {
      throw new HttpError(409, "PHOTO_REQUIRED", "a published listing needs at least one photo");
    }
    try {
      const r = await this.ctx.doc.send(
        new UpdateCommand({
          TableName: this.t,
          Key: listingKey(current.id),
          UpdateExpression: photos.length
            ? "SET photos = :p, coverPhotoId = :cover, updatedAt = :now, #v = #v + :one"
            : "SET photos = :p, updatedAt = :now, #v = #v + :one REMOVE coverPhotoId",
          ConditionExpression: "#v = :expected",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: {
            ":p": photos,
            ":now": new Date().toISOString(),
            ":one": 1,
            ":expected": version,
            ...(photos.length ? { ":cover": photos[0] } : {}),
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return toListing(r.Attributes!);
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "VERSION_CONFLICT", "listing was modified; reload and retry");
      throw e;
    }
  }

  /**
   * Calendar for [from, to). Night items are sparse: a missing item means FREE at the base price.
   * Expired holds are reported as FREE.
   */
  async calendar(l: Listing, from: string, to: string): Promise<Night[]> {
    const nights = eachNight(from, to);
    const last = nights[nights.length - 1]!;
    const stored = new Map<string, Record<string, NativeAttributeValue>>();
    let start: Record<string, NativeAttributeValue> | undefined;
    do {
      const r = await this.ctx.doc.send(
        new QueryCommand({
          TableName: this.t,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":pk": `LISTING#${l.id}`, ":a": nightSk(from), ":b": nightSk(last) },
          ExclusiveStartKey: start,
        }),
      );
      for (const it of r.Items ?? []) stored.set(String(it.SK).slice("NIGHT#".length), it);
      start = r.LastEvaluatedKey;
    } while (start);

    const now = Math.floor(Date.now() / 1000);
    return nights.map((date) => {
      const it = stored.get(date);
      if (!it) return { date, status: "FREE", pricePaise: l.basePricePaise };
      const expiredHold = it.status === "HELD" && typeof it.holdExpiresAt === "number" && it.holdExpiresAt < now;
      return {
        date,
        status: expiredHold ? "FREE" : (it.status as Night["status"]),
        pricePaise: (it.pricePaise as number | undefined) ?? l.basePricePaise,
      };
    });
  }

  /**
   * Host blocks/unblocks nights or sets price overrides. Each night is a conditional write that
   * refuses to touch HELD or BOOKED nights, so it can never race with a guest checkout.
   */
  async updateCalendar(listingId: string, u: CalendarUpdate): Promise<{ updated: string[]; conflicts: string[] }> {
    const nights = eachNight(u.from, u.to, MAX_CALENDAR_WRITE_NIGHTS);
    const updated: string[] = [];
    const conflicts: string[] = [];

    const writeOne = async (date: string) => {
      const sets = ["#ttl = :ttl", "updatedAt = :now"];
      const removes: string[] = [];
      const values: Record<string, NativeAttributeValue> = {
        ":ttl": nightTtl(date),
        ":now": new Date().toISOString(),
        ":free": "FREE",
        ":blocked": "BLOCKED",
      };
      if (u.status) {
        sets.push("#s = :status");
        values[":status"] = u.status;
      } else {
        sets.push("#s = if_not_exists(#s, :free)");
      }
      if (u.pricePaise === null) removes.push("pricePaise");
      else if (u.pricePaise !== undefined) {
        sets.push("pricePaise = :price");
        values[":price"] = u.pricePaise;
      }
      try {
        await this.ctx.doc.send(
          new UpdateCommand({
            TableName: this.t,
            Key: nightKey(listingId, date),
            UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
            ConditionExpression: "attribute_not_exists(SK) OR #s IN (:free, :blocked)",
            ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
            ExpressionAttributeValues: values,
          }),
        );
        updated.push(date);
      } catch (e) {
        if (isConditionalFailure(e)) conflicts.push(date);
        else throw e;
      }
    };

    for (let i = 0; i < nights.length; i += CALENDAR_WRITE_CONCURRENCY) {
      await Promise.all(nights.slice(i, i + CALENDAR_WRITE_CONCURRENCY).map(writeOne));
    }
    updated.sort();
    conflicts.sort();
    return { updated, conflicts };
  }
}
