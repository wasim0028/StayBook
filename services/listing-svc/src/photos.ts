import { randomUUID } from "node:crypto";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 600;

/**
 * Photo pipeline contract (shared with the image-processor Lambda):
 *   1. Client uploads the original to   s3://<bucket>/uploads/listings/<listingId>/<photoId>
 *      using a presigned POST (size and content type enforced by S3 itself).
 *   2. image-processor (S3 ObjectCreated on uploads/) strips EXIF/GPS, moderates, and writes
 *      s3://<bucket>/listings/<listingId>/<photoId>/w{360,720,1280}.webp
 *   3. CloudFront serves only the listings/* prefix; uploads/* is never public.
 */
export interface PhotoStore {
  presignUpload(listingId: string, contentType: string): Promise<{ photoId: string; url: string; fields: Record<string, string> }>;
  exists(listingId: string, photoId: string): Promise<boolean>;
}

export const uploadKey = (listingId: string, photoId: string) => `uploads/listings/${listingId}/${photoId}`;

export function s3PhotoStore(bucket: string, s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-south-1" })): PhotoStore {
  return {
    async presignUpload(listingId, contentType) {
      const photoId = randomUUID();
      const { url, fields } = await createPresignedPost(s3, {
        Bucket: bucket,
        Key: uploadKey(listingId, photoId),
        Conditions: [
          ["content-length-range", 1, MAX_PHOTO_BYTES],
          ["eq", "$Content-Type", contentType],
        ],
        Fields: { "Content-Type": contentType },
        Expires: UPLOAD_TTL_SECONDS,
      });
      return { photoId, url, fields };
    },
    async exists(listingId, photoId) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: uploadKey(listingId, photoId) }));
        return true;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || status === 403) return false;
        throw e;
      }
    },
  };
}

export function photoUrl(cdnBase: string, listingId: string, photoId: string, width: 360 | 720 | 1280 = 720): string {
  return `${cdnBase.replace(/\/$/, "")}/listings/${listingId}/${photoId}/w${width}.webp`;
}
