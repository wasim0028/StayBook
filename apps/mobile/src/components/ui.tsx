import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { toneColors, useTheme, type Tone } from "./theme";

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = "primary",
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** "secondary" is kept as an alias of "outline" for older call sites. */
  variant?: Variant;
  icon?: ComponentProps<typeof Ionicons>["name"];
  style?: ViewStyle;
}) {
  const t = useTheme();
  const v = variant === "secondary" ? "outline" : variant;
  const bg = v === "primary" ? t.accent : v === "danger" ? t.danger : v === "outline" ? t.card : "transparent";
  const fg = v === "primary" ? t.accentText : v === "danger" ? "#FFFFFF" : t.text;
  const border = v === "outline" ? t.border : v === "ghost" ? "transparent" : bg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.centered, { backgroundColor: t.bg }]}>{children}</View>;
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <Centered>
      <Ionicons name="cloud-offline-outline" size={40} color={t.muted} />
      <Text style={{ color: t.text, fontSize: 16, textAlign: "center", marginVertical: 16 }}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="outline" onPress={onRetry} /> : null}
    </Centered>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; body?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.empty, { borderColor: t.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: t.surface }]}>
        <Ionicons name={icon} size={26} color={t.muted} />
      </View>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", textAlign: "center" }}>{title}</Text>
      {body ? <Text style={{ color: t.muted, textAlign: "center", marginTop: 6, lineHeight: 20 }}>{body}</Text> : null}
      {action ? <View style={{ marginTop: 18 }}>{action}</View> : null}
    </View>
  );
}

export function Badge({ tone = "neutral", label }: { tone?: Tone; label: string }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]} accessibilityRole={tone === "bad" ? "alert" : undefined}>
      <Text style={{ color: c.fg, fontWeight: "600", lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { justifyContent: "space-between", marginBottom: 12 }]}>
      <Text style={{ color: t.text, fontSize: 19, fontWeight: "700" }}>{children}</Text>
      {right}
    </View>
  );
}

export function Field({ label, hint, error, style, ...rest }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: t.text, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        style={[styles.input, { borderColor: error ? t.danger : t.border, color: t.text, backgroundColor: t.card }, rest.multiline && { minHeight: 96, textAlignVertical: "top", paddingTop: 12 }, style]}
        accessibilityLabel={label}
        {...rest}
      />
      {error ? <Text style={{ color: t.danger, marginTop: 4 }}>{error}</Text> : hint ? <Text style={{ color: t.muted, marginTop: 4, fontSize: 13 }}>{hint}</Text> : null}
    </View>
  );
}

export function Stars({ value, size = 14, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  const t = useTheme();
  return (
    <View style={styles.row} accessibilityRole={onChange ? "adjustable" : "text"} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}>
            <Ionicons name={n <= value ? "star" : "star-outline"} size={size} color={n <= value ? t.accent : t.border} />
          </Pressable>
        ) : (
          <Ionicons key={n} name={n <= value ? "star" : "star-outline"} size={size} color={n <= value ? t.text : t.border} />
        ),
      )}
    </View>
  );
}

export function KeyValue({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { justifyContent: "space-between", paddingVertical: 4 }]}>
      <Text style={{ color: bold ? t.text : t.muted, fontWeight: bold ? "700" : "400" }}>{k}</Text>
      <Text style={{ color: t.text, fontWeight: bold ? "700" : "400" }}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 16, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty: { alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 18, paddingVertical: 40, paddingHorizontal: 24, margin: 4 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  notice: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, fontSize: 16 },
});
