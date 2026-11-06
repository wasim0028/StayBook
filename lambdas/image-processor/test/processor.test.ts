import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { outputKey, parseUploadKey, processUpload, WIDTHS, type Moderator, type ObjectStore } from "../src/processor.js";

const L = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const KEY = `uploads/listings/${L}/${P}`;

function memStore(initial: Record<string, Buffer>) {
  const objs = new Map(Object.entries(initial));
  const store: ObjectStore = {
    async get(key) {
      const b = objs.get(key);
      if (!b) throw new Error("NoSuchKey");
      return { bytes: b, size: b.length };
    },
    async put(key, body, ct) {
      expect(ct).toBe("image/webp");
      objs.set(key, body);
    },
    async delete(key) {
      objs.delete(key);
    },
  };
  return { store, objs };
}
const log = { info() {}, warn() {}, error() {} };

/** A real JPEG with GPS EXIF and a non-default orientation. */
async function photo(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: { IFD0: { Make: "SecretCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "15/1 29/1 0/1" } },
    })
    .toBuffer();
}

describe("parseUploadKey", () => {
  it("accepts only uploads/listings/<uuid>/<uuid>", () => {
    expect(parseUploadKey(KEY)).toEqual({ listingId: L, photoId: P });
    expect(parseUploadKey("uploads/listings/x/y")).toBeUndefined();
    expect(parseUploadKey(`listings/${L}/${P}/w720.webp`)).toBeUndefined();
    expect(parseUploadKey(`uploads/listings/${L}/${P}/extra`)).toBeUndefined();
  });
});

describe("processUpload", () => {
  it("writes three webp sizes, never upscales, and drops EXIF/GPS", async () => {
    const src = await photo(1000, 600);
    const inMeta = await sharp(src).metadata();
    expect(inMeta.exif).toBeDefined(); // sanity: the input carries EXIF and a rotation
    expect(inMeta.orientation).toBe(6);
    const { store, objs } = memStore({ [KEY]: src });

    expect(await processUpload({ store, log }, KEY)).toBe("processed");

    for (const w of WIDTHS) {
      const out = objs.get(outputKey(L, P, w));
      expect(out, `w${w}`).toBeDefined();
      const m = await sharp(out!).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
    }
    // Orientation 6 means the stored 1000x600 displays as 600x1000; rotate() makes that real, so the
    // 360 rendition is 360 wide and the 1280 one is capped at the (rotated) source width of 600.
    expect((await sharp(objs.get(outputKey(L, P, 360))!).metadata()).width).toBe(360);
    expect((await sharp(objs.get(outputKey(L, P, 1280))!).metadata()).width).toBe(600);
    expect((await sharp(objs.get(outputKey(L, P, 1280))!).metadata()).height).toBe(1000);
    expect(objs.has(KEY)).toBe(true); // original kept (lifecycle rule expires it)
  });

  it("is idempotent: processing twice gives the same keys", async () => {
    const { store, objs } = memStore({ [KEY]: await photo(800, 800) });
    await processUpload({ store, log }, KEY);
    const before = [...objs.keys()].sort();
    await processUpload({ store, log }, KEY);
    expect([...objs.keys()].sort()).toEqual(before);
  });

  it("rejects and deletes files that are not images", async () => {
    const { store, objs } = memStore({ [KEY]: Buffer.from("<?php echo 1; ?>") });
    expect(await processUpload({ store, log }, KEY)).toBe("rejected");
    expect(objs.size).toBe(0);
  });

  it("rejects images that are too small", async () => {
    const { store, objs } = memStore({ [KEY]: await photo(300, 300) });
    expect(await processUpload({ store, log }, KEY)).toBe("rejected");
    expect([...objs.keys()]).toEqual([]);
  });

  it("rejects what the moderator flags, writing no renditions", async () => {
    const { store, objs } = memStore({ [KEY]: await photo(800, 800) });
    const moderator: Moderator = { check: async () => ["Explicit Nudity"] };
    expect(await processUpload({ store, moderator, log }, KEY)).toBe("rejected");
    expect(objs.size).toBe(0);
  });

  it("lets a failing moderator fail the run (S3 retries) rather than publish unchecked", async () => {
    const { store, objs } = memStore({ [KEY]: await photo(800, 800) });
    const moderator: Moderator = { check: async () => { throw new Error("rekognition down"); } };
    await expect(processUpload({ store, moderator, log }, KEY)).rejects.toThrow("rekognition down");
    expect([...objs.keys()]).toEqual([KEY]);
  });

  it("ignores keys outside the pipeline", async () => {
    const { store } = memStore({});
    expect(await processUpload({ store, log }, "uploads/listings/bad")).toBe("ignored");
  });
});
