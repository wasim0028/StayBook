import clsx from "clsx";

/** Plain module (no "use client") so server components can style links as buttons too. */
export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover shadow-sm",
  secondary: "bg-fg text-bg hover:opacity-90",
  outline: "border border-line bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-5 text-[15px] rounded-xl",
  lg: "h-13 px-7 text-base rounded-xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none",
    "disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
    variants[variant],
    sizes[size],
    extra,
  );
}
