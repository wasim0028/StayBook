import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useInboxSummary, useThreads } from "@/api/hooks";
import type { InboxThread } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/components/theme";
import { Button, Centered, EmptyState, ErrorView } from "@/components/ui";
import { shortWhen } from "@/lib/messaging";

type Filter = "all" | "unread";

export default function Inbox() {
  const t = useTheme();
  const { user, ready, signIn } = useAuth();
  const summary = useInboxSummary(!!user);
  const threads = useThreads(!!user, summary.data?.version); // refetches only when something changed
  const [filter, setFilter] = useState<Filter>("all");

  if (!ready) return <Centered>{null}</Centered>;
  if (!user) {
    return (
      <Centered>
        <EmptyState icon="chatbubbles-outline" title="Messages" body="Sign in to message hosts and see replies." action={<Button title="Sign in" onPress={() => void signIn()} />} />
      </Centered>
    );
  }
  if (threads.isError) return <ErrorView message={(threads.error as Error).message} onRetry={() => threads.refetch()} />;
  const items = (threads.data?.items ?? []).filter((x) => filter === "all" || x.unread > 0);

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={items}
      keyExtractor={(x) => x.threadId}
      refreshing={threads.isRefetching}
      onRefresh={() => void summary.refetch().then(() => threads.refetch())}
      contentContainerStyle={{ flexGrow: 1 }}
      ListHeaderComponent={
        <View style={styles.chips}>
          {(["all", "unread"] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, { borderColor: filter === f ? t.text : t.border, backgroundColor: filter === f ? t.text : t.card }]} accessibilityRole="tab" accessibilityState={{ selected: filter === f }}>
              <Text style={{ color: filter === f ? t.bg : t.text, fontWeight: "700" }}>{f === "all" ? "All" : `Unread${summary.data?.unread ? ` (${summary.data.unread})` : ""}`}</Text>
            </Pressable>
          ))}
        </View>
      }
      renderItem={({ item }) => <Row x={item} />}
      ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: 88 }} />}
      ListEmptyComponent={
        threads.isLoading ? undefined : (
          <Centered>
            <EmptyState icon="chatbubbles-outline" title={filter === "all" ? "No messages yet" : "All caught up"} body={filter === "all" ? "Contact a host from any listing. Their replies show up here." : undefined} />
          </Centered>
        )
      }
    />
  );
}

function Row({ x }: { x: InboxThread }) {
  const t = useTheme();
  const bold = x.unread > 0;
  return (
    <Pressable onPress={() => router.push({ pathname: "/thread/[id]", params: { id: x.threadId } })} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface : t.bg }]} accessibilityRole="button" accessibilityLabel={`${x.otherName}, ${x.listingTitle}${x.unread ? `, ${x.unread} unread` : ""}`}>
      <View>
        <Image source={x.coverPhotoUrl ?? undefined} style={[styles.thumb, { backgroundColor: t.surface }]} contentFit="cover" />
        <View style={[styles.avatar, { backgroundColor: t.text, borderColor: t.bg }]}>
          <Text style={{ color: t.bg, fontWeight: "800", fontSize: 12 }}>{x.otherName.charAt(0).toUpperCase()}</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: bold ? "800" : "600", fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{x.otherName}</Text>
          {x.lastMessageAt ? <Text style={{ color: t.muted, fontSize: 12 }}>{shortWhen(x.lastMessageAt)}</Text> : null}
        </View>
        <Text style={{ color: bold ? t.text : t.muted, fontWeight: bold ? "600" : "400" }} numberOfLines={1}>
          {x.lastFromMe ? "You: " : ""}
          {x.lastPreview}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={x.role === "host" ? "home-outline" : "airplane-outline"} size={12} color={t.muted} />
          <Text style={{ color: t.muted, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>{x.listingTitle}</Text>
        </View>
      </View>
      {x.unread > 0 ? (
        <View style={[styles.dot, { backgroundColor: t.accent }]}>
          <Text style={{ color: t.accentText, fontSize: 11, fontWeight: "800" }}>{x.unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  thumb: { width: 58, height: 58, borderRadius: 12 },
  avatar: { position: "absolute", right: -6, bottom: -6, width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dot: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
});
