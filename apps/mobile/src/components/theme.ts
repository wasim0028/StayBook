import { useColorScheme } from "react-native";

/** Same palette as the web app (apps/web/src/app/globals.css), so both feel like one product. */
const light = {
  bg: "#FAF9F7",
  card: "#FFFFFF",
  surface: "#F3F1EE",
  text: "#1C1917",
  muted: "#6B6560",
  border: "#E7E3DE",
  accent: "#E5483A",
  accentText: "#FFFFFF",
  accentSoft: "#FDEBE8",
  danger: "#B91C1C",
  ok: "#15803D",
  okSoft: "#E6F4EA",
  warn: "#B45309",
  warnSoft: "#FEF3C7",
  badSoft: "#FDE8E8",
  info: "#1D4ED8",
  infoSoft: "#E8EFFF",
};

const dark: typeof light = {
  bg: "#131110",
  card: "#1C1917",
  surface: "#26221F",
  text: "#F5F2EE",
  muted: "#A39D96",
  border: "#36312D",
  accent: "#F0594B",
  accentText: "#1C0A08",
  accentSoft: "#3A1B17",
  danger: "#F87171",
  ok: "#4ADE80",
  okSoft: "#12301D",
  warn: "#FBBF24",
  warnSoft: "#34270A",
  badSoft: "#3B1414",
  info: "#93B4FF",
  infoSoft: "#172544",
};

export type Theme = typeof light;
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brand";

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export function toneColors(t: Theme, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "ok":
      return { fg: t.ok, bg: t.okSoft };
    case "warn":
      return { fg: t.warn, bg: t.warnSoft };
    case "bad":
      return { fg: t.danger, bg: t.badSoft };
    case "info":
      return { fg: t.info, bg: t.infoSoft };
    case "brand":
      return { fg: t.accent, bg: t.accentSoft };
    default:
      return { fg: t.muted, bg: t.surface };
  }
}
