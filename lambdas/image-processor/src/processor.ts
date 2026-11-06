import sharp from "sharp";

/**
 * Photo pipeline (contract shared with listing-svc/src/photos.ts):
 *   uploads/listings/<listingId>/<photoId>  ->  listings/<listingId>/<photoId>/w{360,720,1280}.webp
 * sharp re-encodes from pixels, so EXIF (GPS, camera serials) is dropped; rotate() applies the EXIF
 * orientation first so photos don't come out sideways.
 */

export const WIDTHS = [360, 720, 1280] as const;
export const UPLOAD_PREFIX = "uploads/listings/";
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_INPUT_PIXELS = 80_000_000; // decompression-bomb guard
const MIN_SIDE = 400;

export interface ObjectStore {
  get(key: string): Promise<{ bytes: Buffer; size: number }>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Moderator {
  /** Returns the labels that make the image unacceptable, or [] when it is fine. */
  check(bytes: Buffer): Promise<string[]>;
}

export interface Logger {
  info(msg: string, ctx?: object): void;
  warn(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

export type Outcome = "processed" | "ignored" | "rejected";

export const parseUploadKey = (key: string): { listingId: string; photoId: string } | undefined => {
  const m = /^uploads\/listings\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(key);
  return m ? { listingId: m[1]!, photoId: m[2]! } : undefined;
};

export const outputKey = (listingId: string, photoId: string, width: number) => `listings/${listingId}/${photoId}/w${width}.webp`;

export async function processUpload(
  deps: { store: ObjectStore; moderator?: Moderator; log: Logger },
  key: string,
): Promise<Outcome> {
  const parsed = parseUploadKey(key);
  if (!parsed) {
    deps.log.warn("ignoring unexpected key", { key });
    return "ignored";
  }
  const { listingId, photoId } = parsed;

  const reject = async (reason: string, ctx: object = {}): Promise<Outcome> => {
    deps.log.warn("photo rejected", { key, reason, ...ctx });
    // The original is removed so a bad upload can't be re-served or re-processed.
    await deps.store.delete(key);
    return "rejected";
  };

  const { bytes, size } = await deps.store.get(key);
  if (size > MAX_INPUT_BYTES) return reject("TOO_LARGE", { size });

  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    return reject("NOT_AN_IMAGE");
  }
  if (!["jpeg", "png", "webp", "heif", "tiff", "gif"].includes(meta.format ?? "")) return reject("UNSUPPORTED_FORMAT", { format: meta.format });
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < MIN_SIDE) return reject("TOO_SMALL", { width: w, height: h });

  if (deps.moderator) {
    const labels = await deps.moderator.check(bytes);
    if (labels.length > 0) return reject("MODERATION", { labels });
  }

  for (const width of WIDTHS) {
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    await deps.store.put(outputKey(listingId, photoId, width), out, "image/webp");
  }
  deps.log.info("photo processed", { listingId, photoId, width: w, height: h });
  return "processed";
}
