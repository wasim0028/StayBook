import { router, Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { useMe, useOnboard, useRefreshPayoutStatus, type OnboardingInput } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { Badge, Button, Card, Centered, Field, Notice } from "@/components/ui";
import { payoutUi } from "@/lib/host";

const TYPES: [string, string][] = [["individual", "Individual"], ["proprietorship", "Proprietor"], ["partnership", "Partnership"], ["llp", "LLP"], ["private_limited", "Pvt Ltd"]];

const CHECKS: Record<string, [RegExp, string]> = {
  phone: [/^[6-9]\d{9}$/, "10-digit mobile number"],
  pan: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F"],
  gstin: [/^(|\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])$/, "Check the GSTIN, or leave it empty"],
  postalCode: [/^\d{6}$/, "6-digit PIN code"],
  accountNumber: [/^\d{9,18}$/, "9–18 digits"],
  ifsc: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234"],
};
const REQUIRED = ["legalBusinessName", "contactName", "email", "street1", "city", "state", "beneficiaryName"];

export default function Onboarding() {
  const t = useTheme();
  const { user, refreshSession } = useAuth();
  const me = useMe(!!user);
  const onboard = useOnboard();
  const refresh = useRefreshPayoutStatus();
  const [v, setV] = useState<Record<string, string>>({ businessType: "individual", email: user?.email ?? "" });
  const [errs, setErrs] = useState<Record<string, string>>({});

  if (me.isLoading) return <Centered><ActivityIndicator /></Centered>;
  const h = me.data?.host;

  if (h?.onboardingStep === "done") {
    const ui = payoutUi(h);
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Stack.Screen options={{ title: "Payouts" }} />
        <Card style={{ gap: 8 }}>
          <Badge tone={ui.tone} label={ui.label} />
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{h.legalBusinessName}</Text>
          <Text style={{ color: t.muted }}>Bank account ending {h.bankLast4 ?? "••••"}</Text>
          <Text style={{ color: t.text, lineHeight: 20, marginTop: 4 }}>{ui.body}</Text>
          {h.payoutStatus !== "activated" ? <Button variant="outline" title="Check status" icon="refresh" loading={refresh.isPending} onPress={() => refresh.mutate()} style={{ marginTop: 8 }} /> : null}
        </Card>
        <Text style={{ color: t.muted, lineHeight: 20 }}>Payments are collected by Razorpay. Your share of each booking is held until 24 hours after check-out, then settled to your bank.</Text>
      </ScrollView>
    );
  }

  const set = (k: string, transform?: (s: string) => string) => (s: string) => setV((x) => ({ ...x, [k]: transform ? transform(s) : s }));
  const upper = (s: string) => s.toUpperCase().replace(/\s/g, "");
  const digits = (s: string) => s.replace(/\D/g, "");

  async function submit() {
    const local: Record<string, string> = {};
    for (const [k, [re, msg]] of Object.entries(CHECKS)) if (!re.test(v[k] ?? "")) local[k] = msg;
    for (const k of REQUIRED) if (!v[k]?.trim()) local[k] = "Required";
    setErrs(local);
    if (Object.keys(local).length) return;
    const body: OnboardingInput = {
      legalBusinessName: v.legalBusinessName!.trim(),
      businessType: v.businessType!,
      contactName: v.contactName!.trim(),
      email: v.email!.trim(),
      phone: v.phone!,
      pan: v.pan!,
      ...(v.gstin ? { gstin: v.gstin } : {}),
      address: { street1: v.street1!.trim(), ...(v.street2?.trim() ? { street2: v.street2.trim() } : {}), city: v.city!.trim(), state: v.state!.trim(), postalCode: v.postalCode! },
      bank: { accountNumber: v.accountNumber!, ifsc: v.ifsc!, beneficiaryName: v.beneficiaryName!.trim() },
    };
    onboard.mutate(body, {
      onSuccess: async () => {
        await refreshSession(); // new token carries the "host" group
        router.replace("/hosting");
      },
    });
  }

  const err = onboard.error;
  const errText = err instanceof ApiError && err.code === "ONBOARDING_REJECTED" ? `Razorpay couldn't accept these details: ${err.message}` : err ? (err as Error).message : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Become a host" }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.text, fontSize: 24, fontWeight: "800" }}>Get paid for hosting</Text>
        <Text style={{ color: t.muted, marginTop: 6, marginBottom: 16, lineHeight: 20 }}>We create a Razorpay payout account in your name. They verify your PAN and bank, usually within 1–2 days. You can draft listings meanwhile.</Text>
        {h ? <View style={{ marginBottom: 16 }}><Notice tone="warn">Setup stopped part-way last time. Submit again and we'll pick up where it left off.</Notice></View> : null}

        <Section n={1} title="You or your business">
          <View style={styles.chips}>
            {TYPES.map(([k, label]) => (
              <Pressable key={k} onPress={() => setV((x) => ({ ...x, businessType: k }))} style={[styles.chip, { borderColor: v.businessType === k ? t.text : t.border, backgroundColor: v.businessType === k ? t.surface : t.card }]}>
                <Text style={{ color: t.text, fontWeight: v.businessType === k ? "700" : "500" }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Field label={v.businessType === "individual" ? "Full name (as on PAN)" : "Legal business name"} value={v.legalBusinessName} onChangeText={set("legalBusinessName")} error={errs.legalBusinessName} autoComplete="name" />
          <Field label="PAN" value={v.pan} onChangeText={set("pan", upper)} error={errs.pan} autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" />
          <Field label="GSTIN (optional)" value={v.gstin} onChangeText={set("gstin", upper)} error={errs.gstin} autoCapitalize="characters" maxLength={15} />
        </Section>

        <Section n={2} title="Contact">
          <Field label="Contact person" value={v.contactName} onChangeText={set("contactName")} error={errs.contactName} />
          <Field label="Email" value={v.email} onChangeText={set("email")} error={errs.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Field label="Mobile" value={v.phone} onChangeText={set("phone", digits)} error={errs.phone} keyboardType="number-pad" maxLength={10} autoComplete="tel" />
        </Section>

        <Section n={3} title="Address">
          <Field label="Address line 1" value={v.street1} onChangeText={set("street1")} error={errs.street1} />
          <Field label="Address line 2 (optional)" value={v.street2} onChangeText={set("street2")} />
          <Field label="City" value={v.city} onChangeText={set("city")} error={errs.city} />
          <Field label="State" value={v.state} onChangeText={set("state")} error={errs.state} placeholder="e.g. Goa" />
          <Field label="PIN code" value={v.postalCode} onChangeText={set("postalCode", digits)} error={errs.postalCode} keyboardType="number-pad" maxLength={6} />
        </Section>

        <Section n={4} title="Bank account for payouts">
          <Field label="Account holder name" value={v.beneficiaryName} onChangeText={set("beneficiaryName")} error={errs.beneficiaryName} />
          <Field label="Account number" value={v.accountNumber} onChangeText={set("accountNumber", digits)} error={errs.accountNumber} keyboardType="number-pad" maxLength={18} secureTextEntry={false} />
          <Field label="IFSC" value={v.ifsc} onChangeText={set("ifsc", upper)} error={errs.ifsc} autoCapitalize="characters" maxLength={11} placeholder="HDFC0001234" />
        </Section>

        {Object.keys(errs).length ? <View style={{ marginBottom: 12 }}><Notice tone="bad">Please fix the highlighted fields.</Notice></View> : null}
        {errText ? <View style={{ marginBottom: 12 }}><Notice tone="bad">{errText}</Notice></View> : null}
        <Button title="Create payout account" loading={onboard.isPending} onPress={() => void submit()} />
        <Text style={{ color: t.muted, textAlign: "center", marginTop: 12, fontSize: 13 }}>Sent securely to Razorpay. We keep only the last 4 digits of your account.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Card style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <View style={[styles.num, { backgroundColor: t.text }]}><Text style={{ color: t.bg, fontWeight: "800" }}>{n}</Text></View>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  num: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
