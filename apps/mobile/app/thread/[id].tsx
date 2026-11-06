import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMessages, markThreadRead, postMessage, useThreadDetail } from "@/api/hooks";
import type { ChatMessage } from "@/api/types";
import { useTheme } from "@/components/theme";
import { Badge, Centered, ErrorView } from "@/components/ui";
import { STATUS_UI } from "@/lib/booking-ui";
import { formatRange } from "@/lib/format";
import { clock, dayHeading } from "@/lib/messaging";

const POLL_MS = 4000;
const MAX = 2000;

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const detail = useThreadDetail(id);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]); // newest first (inverted list)
  const [older, setOlder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const newest = useRef<string | null>(null);

  const read = useCallback(() => {
    void markThreadRead(id).then(() => qc.invalidateQueries({ queryKey: ["inbox"] }), () => undefined);
  }, [id, qc]);

  useEffect(() => {
    let stop = false;
    void fetchMessages(id, "?limit=30")
      .then((r) => {
        if (stop) return;
        setMsgs(r.items);
        setOlder(r.nextCursor ?? null);
        newest.current = r.items[0]?.cursor ?? null;
        read();
      })
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [id, read]);

  // Poll for new messages while this screen is open and the app is in the foreground.
  useEffect(() => {
    const tick = async () => {
      if (AppState.currentState !== "active") return;
      try {
        const r = await fetchMessages(id, newest.current ? `?after=${encodeURIComponent(newest.current)}` : "?limit=30");
        const fresh = newest.current ? [...r.items].reverse() : r.items; // to newest-first
        if (!fresh.length) return;
        newest.current = fresh[0]!.cursor;
        setMsgs((cur) => {
          const seen = new Set(cur.map((m) => m.messageId));
          return [...fresh.filter((m) => !seen.has(m.messageId)), ...cur];
        });
        if (fresh.some((m) => !m.mine)) read();
      } catch {
        /* transient */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [id, read]);

  async function loadOlder() {
    if (!older) return;
    const r = await fetchMessages(id, `?limit=30&cursor=${encodeURIComponent(older)}`);
    setMsgs((cur) => [...cur, ...r.items]);
    setOlder(r.nextCursor ?? null);
  }

  async function send(body: string, clientId = Crypto.randomUUID()) {
    const optimistic: ChatMessage = { messageId: clientId, senderId: "me", senderName: "You", mine: true, body, masked: false, createdAt: new Date().toISOString(), cursor: "", pending: true };
    setMsgs((cur) => [optimistic, ...cur.filter((m) => m.messageId !== clientId)]);
    try {
      const m = await postMessage(id, body, clientId);
      setMsgs((cur) => cur.map((x) => (x.messageId === clientId ? m : x)));
      if (!newest.current || m.cursor > newest.current) newest.current = m.cursor;
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch {
      setMsgs((cur) => cur.map((x) => (x.messageId === clientId ? { ...x, pending: false, failed: true } : x)));
    }
  }

  if (detail.isError) return <ErrorView message={(detail.error as Error).message} onRetry={() => detail.refetch()} />;
  const d = detail.data;
  const booking = d?.bookings[0];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <Stack.Screen options={{ title: d?.otherName ?? "Message", headerBackTitle: "Inbox" }} />
      {d ? (
        <Pressable onPress={() => router.push({ pathname: "/listing/[id]", params: { id: d.listingId } })} style={[styles.context, { borderColor: t.border, backgroundColor: t.card }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "700" }} numberOfLines={1}>{d.listingTitle}</Text>
            {booking ? <Text style={{ color: t.muted, fontSize: 13 }}>{formatRange(booking.checkIn, booking.checkOut)} · {booking.guests} guests</Text> : <Text style={{ color: t.muted, fontSize: 13 }}>Enquiry</Text>}
          </View>
          {booking ? <Badge tone={STATUS_UI[booking.status].tone} label={STATUS_UI[booking.status].label} /> : <Ionicons name="chevron-forward" size={18} color={t.muted} />}
        </Pressable>
      ) : null}

      {loading ? (
        <Centered><ActivityIndicator /></Centered>
      ) : (
        <FlatList
          inverted
          data={msgs}
          keyExtractor={(m) => m.messageId}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
          ListFooterComponent={
            d && !d.contactSharing ? (
              <View style={[styles.notice, { backgroundColor: t.surface }]}>
                <Ionicons name="shield-checkmark-outline" size={16} color={t.muted} />
                <Text style={{ color: t.muted, flex: 1, fontSize: 13, lineHeight: 18 }}>Phone numbers, emails and links are hidden until a booking is confirmed. Always pay through StayBook.</Text>
              </View>
            ) : undefined
          }
          ListEmptyComponent={<Text style={{ color: t.muted, textAlign: "center", marginTop: 24, transform: [{ scaleY: -1 }] }}>Say hello to {d?.otherName ?? "them"}.</Text>}
          renderItem={({ item: m, index }) => {
            const prev = msgs[index + 1]; // older neighbour
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            return (
              <View>
                {newDay ? <Text style={[styles.day, { color: t.muted }]}>{dayHeading(m.createdAt)}</Text> : null}
                <View style={[styles.bubbleRow, { justifyContent: m.mine ? "flex-end" : "flex-start" }]}>
                  <View style={{ maxWidth: "80%" }}>
                    <View style={[styles.bubble, m.mine ? { backgroundColor: t.text, borderBottomRightRadius: 6 } : { backgroundColor: t.surface, borderBottomLeftRadius: 6 }, m.pending && { opacity: 0.6 }]}>
                      <Text style={{ color: m.mine ? t.bg : t.text, fontSize: 16, lineHeight: 22 }} selectable>{m.body}</Text>
                    </View>
                    {m.failed ? (
                      <Pressable onPress={() => void send(m.body, m.messageId)} hitSlop={8}>
                        <Text style={[styles.meta, { color: t.danger, textAlign: "right", fontWeight: "700" }]}>Not sent · Tap to retry</Text>
                      </Pressable>
                    ) : (
                      <Text style={[styles.meta, { color: t.muted, textAlign: m.mine ? "right" : "left" }]}>
                        {m.pending ? "Sending…" : clock(m.createdAt)}
                        {m.masked ? " · contact details hidden" : ""}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {d?.role === "admin" ? null : (
        <View style={[styles.composer, { borderColor: t.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            value={draft}
            onChangeText={(s) => setDraft(s.slice(0, MAX))}
            placeholder="Write a message"
            placeholderTextColor={t.muted}
            multiline
            style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
            accessibilityLabel="Message"
          />
          <Pressable
            onPress={() => {
              const body = draft.trim();
              if (!body) return;
              setDraft("");
              void send(body);
            }}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.send, { backgroundColor: t.accent, opacity: draft.trim() ? 1 : 0.35 }]}
          >
            <Ionicons name="arrow-up" size={20} color={t.accentText} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  context: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, marginHorizontal: 14, marginTop: 10, padding: 12 },
  notice: { flexDirection: "row", gap: 8, borderRadius: 14, padding: 12, marginBottom: 12 },
  day: { textAlign: "center", fontSize: 12, fontWeight: "700", marginVertical: 12 },
  bubbleRow: { flexDirection: "row", marginTop: 6 },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  meta: { fontSize: 11, marginTop: 3, marginHorizontal: 4 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, maxHeight: 140 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
