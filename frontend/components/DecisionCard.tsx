/*
 * components/DecisionCard.tsx  —  Decision List Card Component
 *
 * WHY THIS FILE EXISTS:
 * This component renders a single decision as a compact card in the Decisions
 * Feed (Tab 1). It gives the user enough information to identify a decision
 * at a glance without showing every field — the full details are one tap away.
 *
 * WHAT IT SHOWS:
 *   - Source type icon (text / document / audio / email / chat)
 *   - Date the decision was captured
 *   - Decision title (up to 2 lines)
 *   - Summary (up to 3 lines)
 *   - Badges for risks and open questions (so attention-needed items are visible
 *     without opening the detail screen)
 *   - Up to 2 tags as hashtag chips
 *   - A trash icon for deleting the decision
 *
 * WHY SHOW RISK/QUESTION BADGES ON THE CARD?
 * The whole point of capturing decisions is to be able to review them later.
 * Decisions with open risks or unresolved questions are the ones that most
 * need attention. The badges make these decisions visually stand out in the list,
 * so the user can prioritise which ones to revisit — without opening each one.
 *
 * WHY SHOW ONLY 2 TAGS?
 * Tags are supplementary metadata. Showing all tags on the card could make
 * heavily-tagged decisions look cluttered. Two tags give enough context;
 * the full list is visible on the detail screen.
 *
 * HOW IT FITS IN THE APP:
 * Used exclusively in `app/(tabs)/index.tsx` inside a FlatList.
 * The parent passes `onPress` (navigate to detail) and `onDelete` (show
 * confirmation dialog then delete).
 */

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";

// ── Props Type ────────────────────────────────────────────────────────────────

/**
 * Props
 *
 * @property decision - The decision data object from the backend API.
 *                      Typed as `any` because the backend returns a rich object
 *                      and we access specific fields rather than typing the whole shape.
 * @property onPress  - Called when the user taps the card (excluding the delete button).
 *                      The parent handles navigation to the detail screen.
 * @property onDelete - Called when the user taps the trash icon.
 *                      The parent handles the confirmation dialog and API call.
 */
type Props = {
  decision: any;
  onPress: () => void;
  onDelete: () => void;
};

// ── Source Icon Mapping ───────────────────────────────────────────────────────

/**
 * SOURCE_ICONS
 *
 * Maps `source_type` values (set by the backend during ingestion) to
 * Ionicons icon names. This gives the user a visual hint about where
 * the decision came from (typed text, uploaded document, voice recording, etc.).
 *
 * The fallback in the component is "help-circle-outline" for any source type
 * that isn't in this map — handles future source types gracefully.
 */
const SOURCE_ICONS: Record<string, any> = {
  text: "create-outline",             // Typed or pasted text
  document: "document-text-outline",  // Uploaded file (PDF, TXT, MD)
  audio: "mic-outline",               // Voice recording
  email: "mail-outline",              // Email content
  chat: "chatbubbles-outline",        // Chat message / Slack thread
};

/**
 * DecisionCard
 *
 * A tappable card showing a summary of a single decision.
 * Renders the card body as a TouchableOpacity so the entire card is tappable
 * (except the delete button, which has its own onPress handler).
 *
 * @param decision - Full decision object (id, title, summary, source_type,
 *                   created_at, risks_accepted, unresolved_questions, tags).
 * @param onPress  - Navigate to the decision detail screen.
 * @param onDelete - Show confirmation dialog then delete via API.
 */
export default function DecisionCard({ decision, onPress, onDelete }: Props) {
  // Look up the icon name for this decision's source type.
  // Fall back to "help-circle-outline" for unknown source types.
  const icon = SOURCE_ICONS[decision.source_type] ?? "help-circle-outline";

  // Format the date in a short, human-readable format (e.g. "May 12, 2025").
  // `undefined` locale means the device's own locale is used automatically.
  const date = new Date(decision.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    // `activeOpacity={0.75}` gives a subtle press feedback — dims slightly when tapped.
    // This is gentler than the default 0.2 opacity, which can look harsh on dark backgrounds.
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>

      {/* ── Top row: source icon · date · delete button ── */}
      <View style={styles.topRow}>
        {/* Coloured icon box indicating where this decision came from.
            The "+ 22" opacity suffix creates a very subtle indigo background tint. */}
        <View style={styles.sourceIcon}>
          <Ionicons name={icon} size={14} color={Colors.primary} />
        </View>

        {/* Date takes `flex: 1` so it fills the space between the icon and delete button */}
        <Text style={styles.date}>{date}</Text>

        {/* Delete button: `hitSlop={8}` makes it easier to tap without making it visually larger.
            `onPress` is separate from the card's `onPress` — tapping the trash icon
            should NOT also trigger navigation to the detail screen. */}
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={15} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── Title ── */}
      {/* `numberOfLines={2}` truncates with "…" if the title is very long.
          Most decision titles fit in one line, but some AI-generated titles
          can be lengthy — capping at 2 lines keeps the card height consistent. */}
      <Text style={styles.title} numberOfLines={2}>
        {decision.title}
      </Text>

      {/* ── Summary ── */}
      {/* Three lines is enough to give context without making the card too tall.
          The full summary is available on the detail screen. */}
      <Text style={styles.summary} numberOfLines={3}>
        {decision.summary}
      </Text>

      {/* ── Footer: badges + tags ── */}
      {/* The footer row wraps, so if there are many badges and tags they'll
          flow onto the next line rather than overflowing off screen. */}
      <View style={styles.footer}>

        {/* ── Risks badge ── */}
        {/* Only shown if the decision has at least one risk.
            This helps users quickly spot decisions that need attention without
            opening each one. The amber colour signals "caution / awareness needed". */}
        {decision.risks_accepted?.length > 0 && (
          <View style={styles.badge}>
            <Ionicons name="warning-outline" size={11} color={Colors.warning} />
            <Text style={[styles.badgeText, { color: Colors.warning }]}>
              {/* Grammatically correct singular/plural: "1 risk" vs "2 risks" */}
              {decision.risks_accepted.length} risk
              {decision.risks_accepted.length > 1 ? "s" : ""}
            </Text>
          </View>
        )}

        {/* ── Open questions badge ── */}
        {/* Only shown if the decision has unresolved questions.
            Red colour signals "action needed" — these questions should be resolved. */}
        {decision.unresolved_questions?.length > 0 && (
          <View style={styles.badge}>
            <Ionicons name="help-circle-outline" size={11} color={Colors.danger} />
            <Text style={[styles.badgeText, { color: Colors.danger }]}>
              {/* "open" is shorter than "questions" and still clear */}
              {decision.unresolved_questions.length} open
            </Text>
          </View>
        )}

        {/* ── Tags ── */}
        {/* Show up to 2 tags. `slice(0, 2)` ensures we never render more,
            keeping the card footer compact even on heavily-tagged decisions. */}
        {decision.tags?.slice(0, 2).map((t: string) => (
          <View key={t} style={styles.tag}>
            {/* Prepend # so tags look like hashtags */}
            <Text style={styles.tagText}>#{t}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Card container: rounded corners, subtle border, dark surface background
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Top row: icon box · date · delete icon
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },

  // Small square with rounded corners holding the source type icon.
  // The `+ "22"` suffix makes the background very slightly tinted — ~13% opacity.
  sourceIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: Colors.primary + "22",
    justifyContent: "center",
    alignItems: "center",
  },

  // Date: flex: 1 pushes it to fill the middle space, left of the delete button
  date: { flex: 1, color: Colors.textMuted, fontSize: 12 },

  // Extra padding on the delete button so it's easy to tap without hitting the card
  deleteBtn: { padding: 4 },

  // Decision title: prominent, bold, max 2 lines
  title: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
    lineHeight: 22,
  },

  // Summary: muted colour signals it's secondary info; max 3 lines
  summary: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },

  // Footer: wrapping row of badges and tags
  footer: {
    flexDirection: "row",
    flexWrap: "wrap", // Tags wrap to next line if too many to fit
    gap: 6,
  },

  // Badge: small pill with icon + count text
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },

  // Tag chip: indigo-tinted background with "18" = ~9.4% opacity
  tag: {
    backgroundColor: Colors.primary + "18",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: { color: Colors.primary, fontSize: 11, fontWeight: "600" },
});
