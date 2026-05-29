/*
 * app/decision/[id].tsx  —  Decision Detail Screen
 *
 * WHY THIS FILE EXISTS:
 * This screen shows the full details of a single decision — everything the AI
 * extracted from the original source text, voice recording, or file.
 *
 * A decision record is rich and structured. It contains far more than can fit
 * in the compact DecisionCard on the list screen. This screen displays all of it:
 *   - Title and summary
 *   - Rationale (why this choice was made)
 *   - Alternatives that were considered (but not chosen)
 *   - Risks that were knowingly accepted
 *   - Unresolved questions that remain open
 *   - Assumptions the decision rests on
 *   - Who owns this decision
 *   - Who dissented / disagreed
 *   - Systems or areas affected
 *   - Tags for categorisation
 *
 * HOW IT FITS IN THE APP:
 * The user gets here by tapping a DecisionCard on the Decisions Feed (Tab 1).
 * Expo Router reads the [id] from the URL (e.g. /decision/abc-123) and this
 * component fetches the full decision from the backend using that ID.
 * The back arrow (from the header defined in _layout.tsx) takes the user back.
 *
 * THE [id] FILENAME CONVENTION:
 * The square brackets in the filename tell Expo Router this is a dynamic route.
 * The segment between the brackets (`id`) becomes a URL parameter accessible
 * via `useLocalSearchParams`. So navigating to `/decision/abc-123` sets id="abc-123".
 *
 * COMPONENT ARCHITECTURE:
 * Two small helper components are defined in this file:
 *   Pill    — A coloured tag chip (used for tags at the bottom).
 *   Section — A titled list of bullet points (used for most data fields).
 * Both are pure presentational components — no state, no side effects.
 * They are kept in this file because they are only used here.
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import { getDecision } from "@/services/api";

// ── Helper Components ─────────────────────────────────────────────────────────

/**
 * Pill
 *
 * Renders a small coloured badge — used for tag labels at the bottom of the screen.
 * The background is a semi-transparent version of the colour (hex "22" = ~13% opacity)
 * and the border is slightly more opaque (hex "55" = ~33% opacity), creating a
 * "frosted glass" style consistent with the rest of the app.
 *
 * @param label - The text to display inside the pill (e.g. "#frontend").
 * @param color - The colour of the text and border. Defaults to the primary brand colour.
 */
function Pill({
  label,
  color = Colors.primary,
}: {
  label: string;
  color?: string;
}) {
  return (
    <View
      style={[
        styles.pill,
        {
          // Semi-transparent background tinted with the pill colour
          backgroundColor: color + "22",
          // More visible border to outline the pill shape
          borderColor: color + "55",
        },
      ]}
    >
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * Section
 *
 * Renders a titled list of bullet-point items — used for most of the decision's
 * structured data fields (alternatives, risks, questions, assumptions, etc.).
 *
 * WHY a reusable Section component?
 * There are 7 different fields that all follow the same pattern:
 *   icon + coloured title → list of bullet items
 * Without this component, that pattern would be repeated 7 times in the main
 * render, making it hard to read. The Section component encapsulates the pattern.
 *
 * If the `items` array is empty or undefined, the component renders nothing at all.
 * This is important because not every decision has values for every field — the AI
 * only populates fields that have data.
 *
 * @param icon  - Ionicons icon name for the section header.
 * @param title - Section heading text (displayed in all-caps via styles).
 * @param items - Array of strings to render as bullet points.
 * @param color - Colour for the icon, title, and bullet dots. Defaults to primary.
 */
function Section({
  icon,
  title,
  items,
  color,
}: {
  icon: any;
  title: string;
  items: string[];
  color?: string;
}) {
  // If there are no items, render nothing — don't show empty section headers
  if (!items?.length) return null;

  return (
    <View style={styles.section}>
      {/* Section header: icon + capitalised title */}
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color={color ?? Colors.primary} />
        <Text style={[styles.sectionTitle, { color: color ?? Colors.primary }]}>
          {title}
        </Text>
      </View>

      {/* Bullet list of items */}
      {items.map((item, i) => (
        // Using array index as key is acceptable here because this list is static
        // (items don't move or get deleted once rendered)
        <View key={i} style={styles.bulletRow}>
          {/* Bullet dot uses the section colour to reinforce the semantic meaning
              (e.g. red bullets for risks, amber for questions) */}
          <Text style={[styles.bullet, { color: color ?? Colors.primary }]}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

/**
 * DecisionDetailScreen
 *
 * Fetches and displays the full detail of a single decision.
 *
 * State:
 *   decision - The full decision object returned by the backend.
 *              Starts as null (loading) and is populated after the API call.
 *
 * The loading state shows a spinner. Once the decision loads, the spinner
 * is replaced by a ScrollView containing all the decision's structured data.
 */
export default function DecisionDetailScreen() {
  // `useLocalSearchParams` reads the URL parameters defined in the filename.
  // Because the file is named `[id].tsx`, navigating to `/decision/abc-123`
  // makes `id` equal to "abc-123".
  const { id } = useLocalSearchParams<{ id: string }>();

  // `null` means "not yet loaded" — we use this to show the loading spinner
  const [decision, setDecision] = useState<any>(null);

  // Fetch the decision when the screen mounts (or when the id changes).
  // In practice, the id doesn't change while the screen is mounted —
  // the user navigates back and opens a different card instead.
  useEffect(() => {
    getDecision(id).then(setDecision);
  }, [id]);

  // While the decision is loading, show a centred spinner.
  // The header (with back button) is still visible during loading —
  // it's part of the Stack navigator, not this component.
  if (!decision) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  // ── Full detail view ──
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.inner}
    >
      {/* ── Metadata row: date · source type · creator ── */}
      {/* Shows provenance: when the decision was captured, from what source,
          and which family member captured it. */}
      <View style={styles.sourceRow}>
        <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
        <Text style={styles.meta}>
          {/* toLocaleDateString() uses the device's locale for date formatting */}
          {new Date(decision.created_at).toLocaleDateString()} ·{" "}
          {decision.source_type} · {decision.creator_name}
        </Text>
      </View>

      {/* ── Title ── */}
      <Text style={styles.title}>{decision.title}</Text>

      {/* ── Summary ── */}
      {/* A one-to-two sentence overview of what was decided */}
      <Text style={styles.summary}>{decision.summary}</Text>

      {/* ── Rationale ── */}
      {/* The "why" behind the decision. Rationale is always present
          (it's the core of a decision record) so we render it directly
          rather than using the Section helper which guards against empty arrays. */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="bulb-outline" size={16} color={Colors.warning} />
          <Text style={[styles.sectionTitle, { color: Colors.warning }]}>
            Rationale
          </Text>
        </View>
        <Text style={styles.rationaleText}>{decision.rationale}</Text>
      </View>

      {/* ── Structured sections — conditionally rendered via Section helper ── */}

      {/* Alternatives: what other options were on the table but not chosen.
          Using the Hermes violet colour to indicate these are "Hermes-surfaced" insights. */}
      <Section
        icon="git-branch-outline"
        title="Alternatives Considered"
        items={decision.alternatives_considered}
        color={Colors.hermes}
      />

      {/* Risks: what could go wrong — shown in red/danger to draw attention.
          The presence of risks is also signalled by a badge on the DecisionCard
          in the list view, so the user knows to expect them here. */}
      <Section
        icon="warning-outline"
        title="Risks Accepted"
        items={decision.risks_accepted}
        color={Colors.danger}
      />

      {/* Open questions: things that still need resolution — amber to signal
          "attention required but not critical yet" */}
      <Section
        icon="help-circle-outline"
        title="Unresolved Questions"
        items={decision.unresolved_questions}
        color={Colors.warning}
      />

      {/* Assumptions: things taken for granted when making the decision.
          These often become risks later if the assumptions turn out to be wrong. */}
      <Section
        icon="layers-outline"
        title="Assumptions"
        items={decision.assumptions}
        // No custom colour = defaults to primary (indigo)
      />

      {/* Owners: who is responsible for executing or revisiting this decision */}
      <Section
        icon="person-outline"
        title="Owners"
        items={decision.owners}
        color={Colors.success} // Green: positive — someone is taking ownership
      />

      {/* Dissenters: who disagreed with the decision.
          Important for future reference — if the decision goes wrong, dissenters
          may have seen something others missed. */}
      <Section
        icon="person-remove-outline"
        title="Dissenters"
        items={decision.dissenters}
        color={Colors.danger}
      />

      {/* Systems affected: what parts of the product, codebase, or process
          are impacted by this decision */}
      <Section
        icon="hardware-chip-outline"
        title="Systems Affected"
        items={decision.related_systems}
      />

      {/* ── Tags ── */}
      {/* Rendered as Pill chips in a wrapping row at the bottom.
          The `?` in `decision.tags?.length` safely handles the case where
          the tags array is undefined (not yet migrated data from early versions). */}
      {decision.tags?.length > 0 && (
        <View style={styles.tagRow}>
          {decision.tags.map((t: string) => (
            // Prepend # so the tags look like hashtags (matches DecisionCard)
            <Pill key={t} label={`#${t}`} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: {
    padding: 20,
    paddingBottom: 40, // Extra space so the last section isn't cut off at the bottom
  },

  // Full-screen loading spinner container
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },

  // Metadata row: small muted text with a clock icon
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  meta: { color: Colors.textMuted, fontSize: 12 },

  // Decision title: large, bold, high contrast
  title: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 14,
    lineHeight: 30, // Generous line height for multi-line titles
  },

  // Summary: slightly muted, comfortable line height for easy reading
  summary: {
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 20,
  },

  // Section container (shared by Rationale and the Section helper)
  section: { marginBottom: 20 },

  // Section header: icon + all-caps label side by side
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase", // All-caps gives section headers a distinct visual hierarchy
    letterSpacing: 0.5,          // Slight tracking improves all-caps readability
  },

  // Rationale is a paragraph, not a list — rendered as a Text block, not bullets
  rationaleText: { color: Colors.text, fontSize: 15, lineHeight: 23 },

  // Bullet list row: dot + text side by side
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  bullet: { fontSize: 15, lineHeight: 22 }, // Same line height as text for vertical alignment
  bulletText: { color: Colors.text, fontSize: 14, lineHeight: 22, flex: 1 },

  // Tag pills row — wraps onto multiple lines if there are many tags
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap", // Allow tags to wrap to the next line when they overflow
    gap: 8,
    marginTop: 4,
  },

  // Individual tag pill
  pill: {
    borderRadius: 20, // Very rounded = pill shape
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: "600" },
});
