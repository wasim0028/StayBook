"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { call, errorMessage } from "@/lib/client-api";
import type { Listing } from "@/lib/types";

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Resized renditions appear a few seconds after upload (image-processor Lambda), so retry the image until it exists. */
function ProcessedImage({ src, alt }: { src: string; alt: string }) {
  const [attempt, setAttempt] = useState(0);
  const [ok, setOk] = useState(false);
  return (
    <>
      {!ok && (
        <div className="absolute inset-0 grid place-items-center bg-surface-2 text-xs text-muted">
          {attempt > 20 ? "Couldn't process this photo" : <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Processing…</span>}
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={attempt}
        src={attempt ? `${src}?r=${attempt}` : src}
        alt={alt}
        className={`size-full object-cover ${ok ? "" : "opacity-0"}`}
        onLoad={() => setOk(true)}
        onError={() => attempt <= 20 && setTimeout(() => setAttempt((a) => a + 1), 3000)}
      />
    </>
  );
}

export function PhotoManager({ listing, onChange, minToPublish }: { listing: Listing; onChange: (l: Listing) => void; minToPublish: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [drag, setDrag] = useState(false);

  async function uploadOne(file: File, current: Listing): Promise<Listing> {
    const { photoId, url, fields } = await call<{ photoId: string; url: string; fields: Record<string, string> }>(`/v1/listings/${current.id}/photos/upload-url`, { method: "POST", body: { contentType: file.type } });
    const form = new FormData();
    for (const [k, val] of Object.entries(fields)) form.append(k, val);
    form.append("file", file); // must be last for S3 POST
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload of ${file.name} failed (${res.status}).`);
    return call<Listing>(`/v1/listings/${current.id}/photos`, { method: "POST", body: { photoId } });
  }

  async function addFiles(list: FileList | File[]) {
    setErr(undefined);
    const files = [...list];
    const bad = files.find((f) => !TYPES.includes(f.type) || f.size > MAX_BYTES);
    if (bad) return setErr(`${bad.name}: use JPEG, PNG or WebP under 15 MB.`);
    const room = 30 - listing.photos.length;
    if (files.length > room) return setErr(`You can add ${room} more photo${room === 1 ? "" : "s"} (30 maximum).`);
    setUploading({ done: 0, total: files.length });
    let cur = listing;
    try {
      for (const [i, f] of files.entries()) {
        cur = await uploadOne(f, cur);
        onChange(cur);
        setUploading({ done: i + 1, total: files.length });
      }
    } catch (x) {
      setErr(x instanceof Error && !("code" in x) ? x.message : errorMessage(x));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  async function reorder(photos: string[]) {
    setBusy(true);
    setErr(undefined);
    try {
      onChange(await call<Listing>(`/v1/listings/${listing.id}/photos`, { method: "PUT", body: { photos, version: listing.version } }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  const move = (i: number, d: -1 | 1) => {
    const p = [...listing.photos];
    [p[i], p[i + d]] = [p[i + d]!, p[i]!];
    void reorder(p);
  };
  const toFront = (i: number) => void reorder([listing.photos[i]!, ...listing.photos.filter((_, j) => j !== i)]);
  const remove = (i: number) => void reorder(listing.photos.filter((_, j) => j !== i));

  const n = listing.photos.length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Photos</h2>
          <p className="text-sm text-muted">{n} of 30 · at least {minToPublish} to publish. The first photo is the cover.</p>
        </div>
      </div>
      {err && <Alert tone="bad">{err}</Alert>}

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
        disabled={!!uploading}
        className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${drag ? "border-brand bg-brand-soft" : "border-line hover:border-muted"}`}
      >
        {uploading ? (
          <>
            <Loader2 className="size-8 animate-spin text-brand" />
            <span className="mt-3 font-semibold">Uploading {uploading.done + 1 > uploading.total ? uploading.total : uploading.done + 1} of {uploading.total}…</span>
          </>
        ) : (
          <>
            <ImagePlus className="size-8 text-muted" />
            <span className="mt-3 font-semibold">Drag photos here or click to choose</span>
            <span className="text-sm text-muted">JPEG, PNG or WebP · up to 15 MB each · location data is removed</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept={TYPES.join(",")} multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />

      {n > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {listing.photoUrls.map((url, i) => (
            <li key={listing.photos[i]} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-2">
              <ProcessedImage src={url} alt={`Photo ${i + 1}`} />
              {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold shadow">Cover</span>}
              <div className="absolute inset-x-2 bottom-2 flex justify-between opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <div className="flex gap-1">
                  <IconBtn label="Move earlier" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowLeft className="size-4" /></IconBtn>
                  <IconBtn label="Move later" disabled={busy || i === n - 1} onClick={() => move(i, 1)}><ArrowRight className="size-4" /></IconBtn>
                  {i > 0 && <IconBtn label="Make cover" disabled={busy} onClick={() => toFront(i)}><Star className="size-4" /></IconBtn>}
                </div>
                <IconBtn label="Remove photo" disabled={busy || (listing.status === "PUBLISHED" && n <= 1)} onClick={() => remove(i)}><Trash2 className="size-4" /></IconBtn>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid size-8 place-items-center rounded-full bg-surface/95 text-fg shadow hover:bg-surface disabled:opacity-40">
      {children}
    </button>
  );
}
