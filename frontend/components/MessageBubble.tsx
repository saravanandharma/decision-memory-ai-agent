/*
 * components/MessageBubble.tsx  —  Chat Message Bubble Component
 *
 * WHY THIS FILE EXISTS:
 * This component renders a single message in the Ask Hermes conversation screen.
 * It handles two distinct visual styles in one component:
 *   - USER messages: right-aligned, indigo background, white text.
 *   - HERMES messages: left-aligned, dark surface background, with an avatar.
 *
 * WHY ONE COMPONENT FOR BOTH ROLES?
 * User and Hermes messages share the same bubble shape, font, and padding.
 * Only the alignment, colour, and extra metadata (sources) differ by role.
 * A single component with conditional styling is cleaner than two separate
 * components that would duplicate most of their code.
 *
 * COLLAPSIBLE SOURCES:
 * When Hermes answers a question, the backend returns a list of decision records
 * it consulted ("sources"). These are shown as a collapsible section below the
 * bubble. This is important because:
 *   1. VERIFIABILITY — users can see WHICH decisions Hermes based its answer on,
 *      making the AI's answer auditable rather than a black box.
 *   2. NAVIGATION — in a future version, tapping a source could open that decision.
 *   3. CLEANLINESS — by default the sources are hidden to keep the chat tidy.
 *      Only users who want to verify the answer need to expand them.
 *
 * HOW IT FITS IN THE APP:
 * Used exclusively in `app/(tabs)/ask.tsx` inside a FlatList.
 * The parent (AskScreen) creates Message objects and passes them to this component.
 */

import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";

// ── Type ──────────────────────────────────────────────────────────────────────

/**
 * Message
 *
 * The shape of a single conversation message.
 * This type is duplicated from ask.tsx because TypeScript types are not
 * exported/imported across files in this codebase — each file defines what it needs.
 *
 * @property id       - Unique string key for the React list (timestamp-based).
 * @property role     - "user" for messages from the human, "hermes" for AI responses.
 * @property text     - The main message content to display.
 * @property sources  - (Hermes only) Decisions cited in the answer. Each has an
 *                      `id` (UUID) and `title` (display name). Shown in the
 *                      collapsible sources panel below the bubble.
 * @property thinking - (Hermes only) Intermediate reasoning steps from the agent.
 *                      Received from the backend but not yet displayed in the UI.
 *                      Included here for completeness and future use.
 */
type Message = {
  id: string;
  role: "user" | "hermes";
  text: string;
  sources?: { id: string; title: string }[];
  thinking?: string[];
};

/**
 * MessageBubble
 *
 * Renders a single chat message with appropriate styling based on the sender's role.
 *
 * State:
 *   showSources - Whether the collapsible sources panel is expanded.
 *                 Local to this component — each bubble independently manages
 *                 whether its sources are visible. This is correct because different
 *                 messages in the same conversation might have sources expanded or
 *                 collapsed independently.
 *
 * @param message - The Message object to render.
 */
export default function MessageBubble({ message }: { message: Message }) {
  // Controls whether the sources list is expanded or collapsed.
  // Defaults to false (collapsed) — sources are secondary information.
  const [showSources, setShowSources] = useState(false);

  // Determine which side of the screen this bubble appears on.
  // `isHermes` drives all the visual differences between the two roles.
  const isHermes = message.role === "hermes";

  return (
    // The outer row uses `alignSelf` to position the bubble on the correct side.
    // `rowLeft` has `alignSelf: "flex-start"` and `rowRight` has `alignSelf: "flex-end"`.
    // We also reverse the flex direction for user messages so the bubble (no avatar)
    // stays on the right side without extra margin hacks.
    <View style={[styles.row, isHermes ? styles.rowLeft : styles.rowRight]}>

      {/* ── Hermes avatar ── */}
      {/* Only Hermes gets an avatar — the user doesn't need one because their
          bubbles are on the right side (position alone identifies them).
          The "30" hex suffix gives the circle a ~19% opacity purple background. */}
      {isHermes && (
        <View style={styles.avatar}>
          <Text style={styles.avatarIcon}>⚡</Text>
        </View>
      )}

      {/* ── Bubble + optional sources ── */}
      {/* `bubbleWrapper` uses `flex: 1` to take up all remaining width after the avatar.
          The gap between bubble and sources toggle is handled by the wrapper's `gap`. */}
      <View style={styles.bubbleWrapper}>

        {/* ── Message bubble ── */}
        {/* The bubble shape is the same for both roles; only the colour differs:
            - Hermes: dark surface background with a border, squared top-left corner
              to "point" toward the avatar on the left.
            - User: indigo (primary) background, squared top-right corner
              to "point" to the right where the user is. */}
        <View style={[styles.bubble, isHermes ? styles.bubbleHermes : styles.bubbleUser]}>
          <Text style={[styles.text, isHermes ? styles.textHermes : styles.textUser]}>
            {message.text}
          </Text>
        </View>

        {/* ── Sources toggle button ── */}
        {/* Only shown for Hermes messages that have at least one source.
            User messages never have sources.
            The chevron icon flips direction (up/down) to indicate the expand/collapse state. */}
        {isHermes && message.sources && message.sources.length > 0 && (
          <TouchableOpacity
            style={styles.sourcesToggle}
            onPress={() => setShowSources(!showSources)}
          >
            <Ionicons
              name={showSources ? "chevron-up" : "chevron-down"}
              size={12}
              color={Colors.textMuted}
            />
            <Text style={styles.sourcesToggleText}>
              {/* Singular/plural: "1 source" vs "2 sources" */}
              {message.sources.length} source
              {message.sources.length > 1 ? "s" : ""}
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Sources list ── */}
        {/* Only rendered when `showSources` is true AND there are sources.
            The sources panel sits below the toggle button, visually attached
            to the Hermes bubble. Each source shows an icon + the decision title.
            In a future version, tapping a source could navigate to that decision's
            detail screen. */}
        {showSources && message.sources && (
          <View style={styles.sources}>
            {message.sources.map((s) => (
              <View key={s.id} style={styles.sourceRow}>
                <Ionicons
                  name="document-text-outline"
                  size={12}
                  color={Colors.primary}
                />
                {/* `numberOfLines={1}` truncates long decision titles with "…"
                    so a single source doesn't push the bubble off-screen */}
                <Text style={styles.sourceTitle} numberOfLines={1}>
                  {s.title}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Outer row container for the avatar + bubble
  row: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 8, // Space between avatar and bubble
  },

  // Hermes: left-aligned, takes up to 90% of the screen width
  rowLeft: { alignSelf: "flex-start", maxWidth: "90%" },

  // User: right-aligned, takes up to 85% of width, flex direction reversed so
  // the bubble (which has no avatar) stays flush right
  rowRight: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    flexDirection: "row-reverse",
  },

  // Circular avatar for Hermes
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16, // Half = circle
    backgroundColor: Colors.hermes + "30", // Very subtle purple tint background
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2, // Slight top offset so the avatar aligns with the first line of text
  },
  avatarIcon: { fontSize: 14 },

  // Wrapper around the bubble + optional sources panel
  bubbleWrapper: {
    flex: 1, // Take remaining width after the avatar
    gap: 4,
  },

  // Base bubble shape (shared by both roles)
  bubble: { borderRadius: 16, padding: 14 },

  // Hermes bubble: dark background, border, with the top-left corner "pointed"
  // (smaller radius) to visually connect the bubble to the avatar on the left
  bubbleHermes: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopLeftRadius: 4, // Reduced radius on the corner nearest the avatar
  },

  // User bubble: solid brand-colour background, top-right corner pointed
  // (connecting to the right edge where the user conceptually "is")
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderTopRightRadius: 4,
  },

  // Shared text style
  text: { fontSize: 15, lineHeight: 22 },
  textHermes: { color: Colors.text }, // Near-white text on dark background
  textUser: { color: "#fff" },         // White text on indigo background

  // Sources toggle: small text + chevron below the Hermes bubble
  sourcesToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  sourcesToggleText: { color: Colors.textMuted, fontSize: 11 },

  // Sources panel: dark background panel listing the source decisions
  sources: {
    backgroundColor: Colors.background, // Darker than the bubble for visual separation
    borderRadius: 10,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Individual source row: icon + title side by side
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 6 },

  // Source title text: primary colour makes it look like a clickable link
  // (even though tapping is not implemented yet — setting this expectation
  // makes it easy to add navigation later)
  sourceTitle: { color: Colors.primary, fontSize: 12, flex: 1 },
});
