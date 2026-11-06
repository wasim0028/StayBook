import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/api/client";
import { countFilters, useSavedIds, useSearch, type SearchFilters } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import type { SearchResult } from "@/api/types";
import { FiltersSheet } from "@/components/FiltersSheet";
import { SearchSheet, whenLabel, type SearchState } from "@/components/SearchSheet";
import { ListingCard } from "@/components/ListingCard";
import { useTheme } from "@/components/theme";
import { shortINR } from "@/lib/format";

// Default viewport: North Goa. Replace with your launch city.
const INITIAL_REGION: Region = { latitude: 15.53, longitude: 73.78, latitudeDelta: 0.12, longitudeDelta: 0.12 };

function toBBox(r: Region): string {
  const f = (n: number) => n.toFixed(5);
  return [
    f(r.latitude - r.latitudeDelta / 2),
    f(r.longitude - r.longitudeDelta / 2),
    f(r.latitude + r.latitudeDelta / 2),
    f(r.longitude + r.longitudeDelta / 2),
  ].join(",");
}

export default function Explore() {
  const t = useTheme();
  const { user } = useAuth();
  const saved = useSavedIds(!!user);
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [region, setRegion] = useState<Region>(INITIAL_REGION);
  const [query, setQuery] = useState<SearchState>({ range: { guests: 2 } });
  const range = query.range;
  const [picker, setPicker] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nFilters = countFilters(filters);
  const [selected, setSelected] = useState<string | null>(null);

  // Debounce map movement so panning doesn't fire a search per frame.
  const [bbox, setBBox] = useState(() => toBBox(INITIAL_REGION));
  useEffect(() => {
    const id = setTimeout(() => setBBox(toBBox(region)), 350);
    return () => clearTimeout(id);
  }, [region]);

  const params = useMemo(
    () => ({ bbox, checkIn: range.checkIn, checkOut: range.checkOut, guests: range.guests, flex: query.flex?.kind, months: query.flex?.months, ...filters }),
    [bbox, range, query.flex, filters],
  );
  const search = useSearch(params);
  const results = search.data?.results ?? [];
  const tooLarge = search.error instanceof ApiError && search.error.code === "AREA_TOO_LARGE";

  const open = useCallback(
    (item: SearchResult) =>
      router.push({
        pathname: "/listing/[id]",
        params: {
          id: item.id,
          // Flexible search returns each stay's best window; carry it to the listing.
          ...(item.checkIn && item.checkOut ? { checkIn: item.checkIn, checkOut: item.checkOut } : range.checkIn && range.checkOut ? { checkIn: range.checkIn, checkOut: range.checkOut } : {}),
          guests: String(range.guests),
        },
      }),
    [range],
  );

  const nearMe = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    map.current?.animateToRegion(
      { latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.1, longitudeDelta: 0.1 },
      400,
    );
  };

  const selectedItem = results.find((r) => r.id === selected);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Search pill + filters */}
      <View style={[styles.pillRow, { top: insets.top + 8 }]}>
        <Pressable
          onPress={() => setPicker(true)}
          accessibilityRole="button"
          accessibilityLabel="Change where, when and who"
          style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}
        >
          <Ionicons name="search" size={18} color={t.text} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "600" }} numberOfLines={1}>{query.place?.name ?? "Stays in this area"}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>
              {whenLabel(query)} · {range.guests} guest{range.guests === 1 ? "" : "s"}
            </Text>
          </View>
          {search.isFetching ? <ActivityIndicator color={t.muted} /> : null}
        </Pressable>
        <Pressable onPress={() => setFiltersOpen(true)} accessibilityRole="button" accessibilityLabel={`Filters${nFilters ? `, ${nFilters} on` : ""}`} style={[styles.filterBtn, { backgroundColor: t.bg, borderColor: nFilters ? t.text : t.border }]}>
          <Ionicons name="options-outline" size={20} color={t.text} />
          {nFilters ? (
            <View style={[styles.dot, { backgroundColor: t.text }]}>
              <Text style={{ color: t.bg, fontSize: 11, fontWeight: "800" }}>{nFilters}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {view === "map" ? (
        <View style={{ flex: 1 }}>
          <MapView
            ref={map}
            style={StyleSheet.absoluteFill}
            initialRegion={INITIAL_REGION}
            onRegionChangeComplete={setRegion}
            onPress={() => setSelected(null)}
            showsUserLocation
            toolbarEnabled={false}
          >
            {results.map((r) => (
              <Marker
                key={r.id}
                coordinate={{ latitude: r.lat, longitude: r.lng }}
                onPress={(e) => {
                  e.stopPropagation();
                  setSelected(r.id);
                }}
                tracksViewChanges={false}
              >
                <View
                  style={[
                    styles.pin,
                    selected === r.id
                      ? { backgroundColor: t.text, borderColor: t.text }
                      : { backgroundColor: t.bg, borderColor: t.border },
                  ]}
                >
                  <Text style={{ color: selected === r.id ? t.bg : t.text, fontWeight: "700", fontSize: 13 }}>
                    {shortINR(r.pricePaise)}
                  </Text>
                </View>
              </Marker>
            ))}
          </MapView>

          <Pressable onPress={nearMe} style={[styles.fab, { backgroundColor: t.bg, top: insets.top + 84 }]} accessibilityLabel="Show stays near me">
            <Ionicons name="locate" size={20} color={t.text} />
          </Pressable>

          {tooLarge ? (
            <View style={[styles.banner, { backgroundColor: t.text }]}>
              <Text style={{ color: t.bg }}>Zoom in to see stays</Text>
            </View>
          ) : search.data?.truncated ? (
            <View style={[styles.banner, { backgroundColor: t.text }]}>
              <Text style={{ color: t.bg }}>Showing the {results.length} best-priced stays. Zoom in for more.</Text>
            </View>
          ) : null}

          {selectedItem ? (
            <View style={[styles.preview, { backgroundColor: t.bg }]}>
              <ListingCard item={selectedItem} saved={saved.has(selectedItem.id)} onPress={() => open(selectedItem)} />
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingTop: insets.top + 80, paddingBottom: 96 }}
          renderItem={({ item }) => <ListingCard item={item} saved={saved.has(item.id)} onPress={() => open(item)} />}
          refreshing={search.isRefetching}
          onRefresh={() => search.refetch()}
          ListEmptyComponent={
            <Text style={{ color: t.muted, textAlign: "center", marginTop: 48, paddingHorizontal: 24 }}>
              {tooLarge
                ? "Zoom in on the map to search this area."
                : search.isError
                  ? (search.error as Error).message
                  : search.isLoading
                    ? "Searching…"
                    : nFilters ? "No stays match your filters. Try removing some." : "No stays match. Try other dates or move the map."}
            </Text>
          }
        />
      )}

      <Pressable
        onPress={() => setView(view === "map" ? "list" : "map")}
        style={[styles.toggle, { backgroundColor: t.text, bottom: 24 }]}
        accessibilityRole="button"
      >
        <Ionicons name={view === "map" ? "list" : "map"} size={18} color={t.bg} />
        <Text style={{ color: t.bg, fontWeight: "600" }}>
          {view === "map" ? `List (${results.length})` : "Map"}
        </Text>
      </Pressable>

      <SearchSheet
        visible={picker}
        value={query}
        onClose={() => setPicker(false)}
        onApply={(next) => {
          setQuery(next);
          setPicker(false);
          if (next.place && next.place !== query.place) {
            const [s1, w1, n1, e1] = next.place.bbox.split(",").map(Number) as [number, number, number, number];
            const r = { latitude: (s1 + n1) / 2, longitude: (w1 + e1) / 2, latitudeDelta: n1 - s1, longitudeDelta: e1 - w1 };
            map.current?.animateToRegion(r, 500);
            setRegion(r); // list view has no map to report the move
          }
        }}
      />
      <FiltersSheet
        visible={filtersOpen}
        value={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setFiltersOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { position: "absolute", left: 16, right: 16, zIndex: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  filterBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8 },
  dot: { position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  pill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pin: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14, borderWidth: 1 },
  fab: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  banner: { position: "absolute", top: 140, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  preview: { position: "absolute", left: 12, right: 12, bottom: 88, borderRadius: 16, elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10 },
  toggle: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    elevation: 4,
  },
});
