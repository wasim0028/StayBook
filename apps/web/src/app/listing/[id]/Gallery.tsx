"use client";

import { Grid3x3, ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";

export function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!all) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => e.key === "Escape" && setAll(false);
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
  }, [all]);

  if (photos.length === 0) {
    return (
      <div className="grid aspect-[2/1] place-items-center rounded-2xl bg-surface-2 text-muted">
        <ImageOff className="size-10" aria-hidden />
        <span className="sr-only">No photos yet</span>
      </div>
    );
  }

  const img = (src: string, i: number, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={src} alt={`${title}, photo ${i + 1}`} className={`size-full object-cover transition hover:brightness-90 ${cls}`} loading={i === 0 ? "eager" : "lazy"} />
  );

  return (
    <>
      {/* Phones: swipeable strip */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:hidden">
        {photos.map((p, i) => (
          <div key={p} className="aspect-[4/3] w-[88%] shrink-0 snap-center overflow-hidden rounded-2xl">{img(p, i, "")}</div>
        ))}
      </div>
      {/* Larger screens: hero + grid */}
      <div className="relative hidden aspect-[2/1] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl sm:grid">
        <button onClick={() => setAll(true)} className="col-span-2 row-span-2" aria-label="Show all photos">{img(photos[0]!, 0, "")}</button>
        {photos.slice(1, 5).map((p, i) => (
          <button key={p} onClick={() => setAll(true)} aria-label="Show all photos" className={photos.length < 5 && i === photos.length - 2 ? "col-span-2" : ""}>
            {img(p, i + 1, "")}
          </button>
        ))}
        {photos.length > 1 && (
          <button onClick={() => setAll(true)} className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-lg border border-fg/20 bg-surface px-3 py-1.5 text-sm font-semibold shadow-card">
            <Grid3x3 className="size-4" /> Show all {photos.length} photos
          </button>
        )}
      </div>

      {all && (
        <div role="dialog" aria-modal="true" aria-label="All photos" className="fixed inset-0 z-50 overflow-y-auto bg-bg">
          <div className="sticky top-0 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
            <span className="font-semibold">{title}</span>
            <button onClick={() => setAll(false)} aria-label="Close" className="grid size-10 place-items-center rounded-full hover:bg-surface-2"><X className="size-5" /></button>
          </div>
          <div className="mx-auto max-w-3xl space-y-3 p-4">
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p} src={p.replace("/w720.webp", "/w1280.webp")} alt={`${title}, photo ${i + 1}`} className="w-full rounded-xl" loading="lazy" />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
