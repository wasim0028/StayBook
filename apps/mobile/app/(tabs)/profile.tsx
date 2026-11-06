import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMe, useUpdateMe } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { Badge, Button, Card, Centered, EmptyState, Field, Notice } from "@/components/ui";
import { payoutUi } from "@/lib/host";

export default function Profile() {
  const t = useTheme();
  const { user, ready, signIn, signOut } = useAuth();
  const me = useMe(!!user);
  const update = useUpdateMe();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (me.data) {
      setName(me.data.displayName ?? "");
      setPhone(me.data.phone ?? "");
      setBio(me.data.bio ?? "");
    }
  }, [me.data]);

  if (!ready) return <Centered>{null}</Centered>;
  if (!user) {
    return (
      <Centered>
        <EmptyState icon="person-circle-outline" title="Welcome to StayBook" body="Sign in or create an account to book stays, save favourites and host your own place." action={<Button title="Sign in or sign up" onPress={() => void signIn()} />} />
      </Centered>
    );
  }

  const isHost = user.groups.includes("host");
  const display = me.data?.displayName ?? user.email ?? "You";
  const payout = me.data?.host ? payoutUi(me.data.host) : null;

  function save() {
    const body: { displayName?: string; phone?: string; bio?: string } = {};
    if (name.trim() && name.trim() !== me.data?.displayName) body.displayName = name.trim();
    if (phone && phone !== me.data?.phone) body.phone = phone;
    if (bio.trim() !== (me.data?.bio ?? "")) body.bio = bio.trim();
    if (!Object.keys(body).length) return setEditing(false);
    update.mutate(body, { onSuccess: () => setEditing(false) });
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: t.text }]}>
          <Text style={{ color: t.bg, fontSize: 28, fontWeight: "800" }}>{display.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: "800" }} numberOfLines={1}>{display}</Text>
          <Text style={{ color: t.muted }} numberOfLines={1}>{user.email}{isHost ? " · Host" : ""}</Text>
        </View>
      </View>

      <Card>
        {editing ? (
          <>
            <Field label="Display name" value={name} onChangeText={setName} maxLength={60} hint="Shown to hosts and on your reviews." />
            <Field label="Mobile" value={phone} onChangeText={(s) => setPhone(s.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={10} />
            <Field label="About you" value={bio} onChangeText={setBio} multiline maxLength={500} />
            {update.isError ? <View style={{ marginBottom: 12 }}><Notice tone="bad">{(update.error as Error).message}</Notice></View> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button variant="outline" title="Cancel" style={{ flex: 1 }} onPress={() => setEditing(false)} />
              <Button title="Save" style={{ flex: 1 }} loading={update.isPending} onPress={save} />
            </View>
          </>
        ) : (
          <>
            <Row icon="person-outline" label="Name" value={me.data?.displayName ?? "Not set"} />
            <Row icon="call-outline" label="Mobile" value={me.data?.phone ?? "Not set"} />
            {me.data?.bio ? <Text style={{ color: t.muted, marginTop: 8, lineHeight: 20 }}>{me.data.bio}</Text> : null}
            <Button variant="outline" title="Edit profile" icon="create-outline" style={{ marginTop: 12 }} onPress={() => setEditing(true)} />
          </>
        )}
      </Card>

      <Pressable onPress={() => router.push(isHost ? "/hosting" : "/host/onboarding")}>
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>{isHost ? "Switch to hosting" : "Become a host"}</Text>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </View>
          {payout ? <Badge tone={payout.tone} label={payout.label} /> : null}
          <Text style={{ color: t.muted, lineHeight: 20 }}>{isHost ? "Reservations, listings and payouts." : "List your place and get paid to your bank through Razorpay. Setup takes about 10 minutes."}</Text>
        </Card>
      </Pressable>
      {isHost ? (
        <Pressable onPress={() => router.push("/host/onboarding")}>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>Payout account</Text>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Card>
        </Pressable>
      ) : null}

      <Button variant="ghost" title="Sign out" icon="log-out-outline" onPress={() => void signOut()} />
    </ScrollView>
  );
}

function Row({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
      <Ionicons name={icon} size={18} color={t.muted} />
      <Text style={{ color: t.muted, width: 70 }}>{label}</Text>
      <Text style={{ color: t.text, flex: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 8 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
});
