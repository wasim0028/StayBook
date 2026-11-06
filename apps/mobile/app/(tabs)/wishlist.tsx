import { router } from "expo-router";
import { FlatList, Text } from "react-native";
import { useWishlist } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { ListingCard } from "@/components/ListingCard";
import { useTheme } from "@/components/theme";
import { Button, Centered, EmptyState, ErrorView } from "@/components/ui";

export default function Wishlist() {
  const t = useTheme();
  const { user, ready, signIn } = useAuth();
  const list = useWishlist(!!user);

  if (!ready) return <Centered>{null}</Centered>;
  if (!user) {
    return (
      <Centered>
        <EmptyState icon="heart-outline" title="Save stays you love" body="Sign in, then tap the heart on any stay to keep it here." action={<Button title="Sign in" onPress={() => void signIn()} />} />
      </Centered>
    );
  }
  if (list.isError) return <ErrorView message={(list.error as Error).message} onRetry={() => list.refetch()} />;

  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={list.data?.items ?? []}
      keyExtractor={(i) => i.id}
      refreshing={list.isRefetching}
      onRefresh={() => list.refetch()}
      contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
      ListHeaderComponent={list.data?.items.length ? <Text style={{ color: t.muted, paddingHorizontal: 16 }}>{list.data.items.length} saved</Text> : undefined}
      renderItem={({ item }) => <ListingCard item={item} saved onPress={() => router.push({ pathname: "/listing/[id]", params: { id: item.id } })} />}
      ListEmptyComponent={
        list.isLoading ? undefined : (
          <Centered>
            <EmptyState icon="heart-outline" title="Nothing saved yet" body="Tap the heart on any stay to keep it here for later." action={<Button title="Explore stays" onPress={() => router.navigate("/")} />} />
          </Centered>
        )
      }
    />
  );
}
