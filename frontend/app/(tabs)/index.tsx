/*
 * app/(tabs)/index.tsx  —  Decisions Feed Screen
 *
 * WHY THIS FILE EXISTS:
 * This is the main "home" screen of the app — the first thing a logged-in user
 * sees. It displays all decisions the family has captured, sorted newest-first.
 *
 * FEATURES:
 *   - A personalised greeting ("Hello, Sarah 👋") loaded from AsyncStorage.
 *   - A count of how many decisions are stored.
 *   - A live search bar that filters decisions by title, summary, or tags.
 *   - Pull-to-refresh to reload the list from the backend.
 *   - Swipe / tap to open a decision's full detail view.
 *   - A trash icon on each card to delete a decision (with confirmation dialog).
 *   - A logout button that clears AsyncStorage and returns to login.
 *
 * HOW IT FITS IN THE APP:
 * This is Tab 1. It imports DecisionCard to render each list item.
 * Tapping a card navigates to `app/decision/[id].tsx` for the full detail view.
 *
 * DATA FLOW:
 *   Component mounts → load() calls listDecisions() API → setDecisions()
 *   → handleSearch() filters decisions locally (no extra API call)
 *   Pull-to-refresh → onRefresh() calls load() again
 *
 * AUTH ERROR HANDLING:
 * If the API returns an error (e.g. the JWT token has expired), we clear the
 * token from AsyncStorage and redirect to login. This prevents the user from
 * being stuck on a broken screen with no way to re-authenticate.
 */

import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import { listDecisions, deleteDecision } from "@/services/api";
import DecisionCard from "@/components/DecisionCard";

/**
 * FeedScreen
 *
 * The main decisions list screen. Fetches all decisions from the backend
 * on mount and on pull-to-refresh, and supports client-side text search.
 *
 * State:
 *   decisions  - The full list of decisions returned by the backend.
 *                Never modified after fetch — used as the source of truth
 *                for the `filtered` list.
 *   filtered   - The subset of `decisions` that match the current search query.
 *                This is what FlatList actually renders.
 *                Keeping `decisions` and `filtered` separate means we can
 *                restore the full list instantly when the search is cleared —
 *                no extra API call needed.
 *   search     - The current value of the search text input.
 *   refreshing - Whether the pull-to-refresh spinner is active.
 *   userName   - The user's display name, read from AsyncStorage on mount.
 */
export default function FeedScreen() {
  // `decisions` holds the unfiltered list from the server — never mutated directly
  const [decisions, setDecisions] = useState<any[]>([]);
  // `filtered` is what we render — starts as the full list, narrows during search
  const [filtered, setFiltered] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  // `refreshing` drives the native pull-to-refresh spinner indicator
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState("");

  /**
   * load
   *
   * Fetches all decisions from the backend and updates both `decisions`
   * and `filtered` state. This effectively resets any active search filter,
   * which is intentional — after a refresh you want to see everything again.
   *
   * On error: assumes the JWT is expired, clears auth data, and sends the
   * user back to the login screen. This is a simple but effective strategy —
   * any API failure on this screen is treated as an auth problem.
   */
  async function load() {
    try {
      const data = await listDecisions();
      setDecisions(data);
      setFiltered(data); // Reset filter — show all results after refresh
    } catch {
      // Most likely cause: the JWT token expired on the server side.
      // Remove the stored token so the app doesn't try to use it again,
      // then redirect to login so the user can authenticate with fresh credentials.
      await AsyncStorage.removeItem("token");
      router.replace("/login");
    }
  }

  // Load decisions and the user's name when the screen first mounts.
  // Both run independently — the greeting can appear before decisions load.
  useEffect(() => {
    // Read the user name from AsyncStorage (stored during login) for the greeting.
    // Falls back to "" if somehow not stored — the greeting just shows "Hello, 👋"
    AsyncStorage.getItem("userName").then((n) => setUserName(n ?? ""));
    load();
  }, []); // Empty array = run once on mount

  /**
   * onRefresh
   *
   * Called by the RefreshControl when the user pulls the list downward.
   * Sets `refreshing` to true (shows the spinner), fetches fresh data,
   * then sets `refreshing` to false (hides the spinner).
   *
   * `useCallback` memoises this function so RefreshControl doesn't get a
   * new function reference on every render, which would cause unnecessary
   * re-renders of the RefreshControl component.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, []); // No dependencies — `load` is a stable function defined in the same scope

  /**
   * handleSearch
   *
   * Filters the decisions list client-side as the user types.
   * No API call is made — we filter the already-loaded `decisions` array.
   *
   * Why client-side search? The list is limited to 50 items (the API's default
   * page size), which is fast to filter in memory. This approach also works
   * offline and gives instant results with no loading state.
   *
   * Matches on: title, summary, or any tag.
   *
   * @param text - The current value of the search input.
   */
  function handleSearch(text: string) {
    setSearch(text);

    // If the search is empty or only whitespace, restore the full list immediately.
    if (!text.trim()) {
      setFiltered(decisions);
      return;
    }

    const q = text.toLowerCase(); // Normalise to lowercase for case-insensitive matching
    setFiltered(
      decisions.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.summary.toLowerCase().includes(q) ||
          // `d.tags` might be undefined or null for older records — optional chaining handles this
          d.tags?.some((t: string) => t.toLowerCase().includes(q))
      )
    );
  }

  /**
   * handleDelete
   *
   * Shows a native confirmation dialog before deleting a decision.
   * Uses Alert.alert here (not a custom Toast) because this is a destructive
   * action that needs a deliberate confirmation — a blocking dialog is
   * appropriate. (Compare with non-destructive errors which use inline messages.)
   *
   * After deletion: reloads the full list from the server so the deleted
   * item disappears and the count updates correctly.
   *
   * @param id - The UUID of the decision to delete.
   */
  async function handleDelete(id: string) {
    Alert.alert("Delete Decision", "Are you sure?", [
      // "Cancel" does nothing — tapping it dismisses the dialog without deleting
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive", // Shows the button in red on iOS
        onPress: async () => {
          await deleteDecision(id);
          await load(); // Reload the list to reflect the deletion
        },
      },
    ]);
  }

  /**
   * handleLogout
   *
   * Clears all auth-related data from AsyncStorage and navigates to login.
   * We use `multiRemove` instead of individual `removeItem` calls to delete
   * all three keys in a single async operation — slightly more efficient.
   */
  async function handleLogout() {
    // Remove all user-related keys in one call instead of three separate calls
    await AsyncStorage.multiRemove(["token", "userName", "userId"]);
    router.replace("/login");
  }

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          {/* Personalised greeting using the name stored during login */}
          <Text style={styles.greeting}>Hello, {userName} 👋</Text>
          {/* Show the count from the unfiltered `decisions` array, not `filtered`,
              so the count doesn't change while the user is searching */}
          <Text style={styles.subtitle}>{decisions.length} decisions stored</Text>
        </View>
        {/* Logout button — tucked in the top-right corner to be accessible
            but not prominent (users don't log out often) */}
        <TouchableOpacity onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── Search Bar ── */}
      {/* Client-side search: filters the already-loaded decisions as you type.
          The icon is inside the row View so it appears visually inside the input. */}
      <View style={styles.searchRow}>
        <Ionicons
          name="search-outline"
          size={18}
          color={Colors.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search decisions…"
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={handleSearch}
        />
      </View>

      {/* ── Decisions List ── */}
      {/* FlatList is used instead of ScrollView + map because FlatList only
          renders items currently visible on screen (virtualisation). This is
          important for performance when there are many decisions. */}
      <FlatList
        data={filtered}              // Show filtered results (equals `decisions` when no search)
        keyExtractor={(item) => item.id} // Use the server-assigned UUID as the React key
        contentContainerStyle={styles.list}
        // Pull-to-refresh: the native spinner appears when `refreshing` is true
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary} // Spinner colour matches the brand colour
          />
        }
        // ── Empty state ──
        // Shown when the filtered list is empty (either no decisions at all,
        // or the search returned no results). Guides the user on what to do next.
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="archive-outline" size={48} color={Colors.border} />
            <Text style={styles.emptyText}>No decisions yet.</Text>
            <Text style={styles.emptySubtext}>
              Tap Add to capture your first decision.
            </Text>
          </View>
        }
        // Each decision is rendered as a DecisionCard component.
        // `onPress` opens the full detail screen by navigating to the dynamic route.
        // `onDelete` triggers the confirmation dialog → API call.
        renderItem={({ item }) => (
          <DecisionCard
            decision={item}
            // Navigate to the detail screen, using the decision's UUID in the URL.
            // Expo Router's file `app/decision/[id].tsx` receives this as a param.
            onPress={() => router.push(`/decision/${item.id}`)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header row: greeting on the left, logout icon on the right
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,    // Extra top padding to clear the device's status bar area
    paddingBottom: 16,
  },
  greeting: { color: Colors.text, fontSize: 22, fontWeight: "700" },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },

  // Search bar: icon + text input inside a styled container
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: Colors.text,
    paddingVertical: 12,
    fontSize: 15,
  },

  list: {
    paddingHorizontal: 20,
    paddingBottom: 24, // Extra bottom padding so the last card isn't hidden by the tab bar
  },

  // Empty state: centred icon + message
  empty: { alignItems: "center", marginTop: 80, gap: 8 },
  emptyText: { color: Colors.text, fontSize: 18, fontWeight: "600" },
  emptySubtext: { color: Colors.textMuted, fontSize: 14 },
});
