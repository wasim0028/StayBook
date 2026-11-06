import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SearchResult, WishlistItem } from "@/api/types";
import { formatINR, formatRange } from "@/lib/format";
import { HeartButton } from "./HeartButton";
import { useTheme } from "./theme";

type Item = Pick<SearchResult, "id" | "title" | "city" | "pricePaise" | "coverPhotoUrl" | "ratingAvg" | "ratingCount"> & Partial<Pick<SearchResult, "bedrooms" | "maxGuests" | "totalPaise" | "superhost" | "instantBook" | "checkIn" | "checkOut">>;

export function ListingCard({ item, onPress, saved }: { item: Item | WishlistItem; onPress: () => void; saved?: boolean }) {
  const t = useTheme();
  const i = item as Item;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${formatINR(item.pricePaise)} per night`}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
    >
      <View>
        <Image source={item.coverPhotoUrl ?? undefined} style={[styles.photo, { backgroundColor: t.surface }]} contentFit="cover" transition={150} recyclingKey={item.id} />
        {saved !== undefined ? <HeartButton id={item.id} saved={saved} /> : null}
        {i.superhost ? (
          <View style={[styles.pill, { backgroundColor: "rgba(255,255,255,0.95)" }]}>
            <Text style={{ color: "#111", fontWeight: "700", fontSize: 12 }}>Superhost</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.row}>
        <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>
          {i.instantBook ? <Ionicons name="flash" size={14} color={t.text} accessibilityLabel="Instant Book" /> : null}
          {i.instantBook ? " " : ""}
          {item.title}
        </Text>
        {item.ratingCount ? (
          <View style={styles.rating}>
            <Ionicons name="star" size={13} color={t.text} />
            <Text style={{ color: t.text, fontWeight: "600" }}>{item.ratingAvg?.toFixed(2)}</Text>
            <Text style={{ color: t.muted }}>({item.ratingCount})</Text>
          </View>
        ) : (
          <Text style={{ color: t.muted }}>New</Text>
        )}
      </View>
      <Text style={{ color: t.muted, marginTop: 2 }}>
        {item.city}
        {i.bedrooms != null ? ` · ${i.bedrooms} bedroom${i.bedrooms === 1 ? "" : "s"}` : ""}
        {i.maxGuests != null ? ` · up to ${i.maxGuests} guests` : ""}
      </Text>
      {i.checkIn && i.checkOut ? <Text style={{ color: t.muted }}>{formatRange(i.checkIn, i.checkOut)}</Text> : null}
      <Text style={{ color: t.text, marginTop: 4, fontSize: 15 }}>
        <Text style={styles.price}>{formatINR(item.pricePaise)}</Text> night
        {i.totalPaise != null ? <Text style={{ color: t.muted }}> · {formatINR(i.totalPaise)} total</Text> : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 12 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: 16, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  title: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  price: { fontWeight: "700" },
  pill: { position: "absolute", top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
});
