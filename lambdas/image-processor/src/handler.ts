import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DetectModerationLabelsCommand, RekognitionClient } from "@aws-sdk/client-rekognition";
import { processUpload, UPLOAD_PREFIX, type Logger, type Moderator, type ObjectStore } from "./processor.js";

const s3 = new S3Client({});
const log: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: "warn", msg, ...ctx })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: "error", msg, ...ctx })),
};

function s3Store(bucket: string): ObjectStore {
  return {
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = Buffer.from(await r.Body!.transformToByteArray());
      return { bytes, size: bytes.length };
    },
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }),
      );
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** Optional: set ENABLE_MODERATION=true (needs rekognition:DetectModerationLabels). Fails closed on error. */
function rekognitionModerator(): Moderator {
  const client = new RekognitionClient({});
  return {
    async check(bytes) {
      // Rekognition's inline image limit is 5 MB; moderate a 1280px rendition instead of the original.
      const { default: sharp } = await import("sharp");
      const small = await sharp(bytes).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const r = await client.send(new DetectModerationLabelsCommand({ Image: { Bytes: small }, MinConfidence: 80 }));
      return (r.ModerationLabels ?? []).filter((l) => !l.ParentName).map((l) => l.Name ?? "unknown");
    },
  };
}

const moderator = process.env.ENABLE_MODERATION === "true" ? rekognitionModerator() : undefined;

interface S3Event {
  Records: { s3: { bucket: { name: string }; object: { key: string } } }[];
}

/**
 * S3 ObjectCreated on uploads/listings/. S3 delivers at least once and processing is idempotent
 * (same input, same output keys). A thrown error fails the invocation and S3 retries asynchronously.
 */
export async function handler(event: S3Event): Promise<{ processed: number; rejected: number; ignored: number }> {
  const tally = { processed: 0, rejected: 0, ignored: 0 };
  for (const rec of event.Records) {
    // S3 event keys are URL-encoded, with spaces as '+'.
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    if (!key.startsWith(UPLOAD_PREFIX)) {
      tally.ignored++;
      continue;
    }
    tally[await processUpload({ store: s3Store(rec.s3.bucket.name), moderator, log }, key)]++;
  }
  return tally;
}
