/*
 * constants/Colors.ts
 *
 * WHY THIS FILE EXISTS:
 * All colour values used throughout the app live here in one place.
 * This is a "single source of truth" for the visual theme.
 * If you ever want to change the look of the app — swap to a light theme,
 * adjust the brand colour, etc. — you only edit this one file instead of
 * hunting through dozens of StyleSheet calls scattered across every screen.
 *
 * HOW IT FITS IN THE APP:
 * Every screen and component imports `Colors` from here and references
 * e.g. `Colors.background` or `Colors.primary` in their StyleSheet.
 * No colour hex values should appear "hardcoded" anywhere else.
 *
 * PALETTE CHOICE:
 * The app uses a dark theme (dark navy/slate background, light text).
 * Dark themes reduce eye strain in low-light environments and give the app
 * a focused, professional feel — appropriate for a decision-tracking tool
 * used in meetings and late-night retrospectives.
 *
 * The colour names follow Tailwind CSS conventions (e.g. slate-900, indigo-500)
 * so developers already familiar with Tailwind can instantly recognise the shades.
 */

export const Colors = {
  // ── Brand / Action ──────────────────────────────────────────────────────────

  // The primary indigo colour is used for interactive elements: buttons,
  // active tab indicators, focused borders, and tag pills.
  // Indigo sits between blue and purple — it feels trustworthy yet modern.
  primary: "#6366f1",       // indigo-500

  // A slightly darker shade of primary, used when a pressed/hover state is
  // needed — e.g. on web where hover effects matter.
  primaryDark: "#4f46e5",   // indigo-600

  // ── Surfaces ────────────────────────────────────────────────────────────────

  // The "surface" colour is for cards, input backgrounds, and tab bars —
  // anything that sits one layer above the page background.
  // Using slate-800 (slightly lighter than the background) creates depth
  // without needing shadows, which are expensive to render on mobile.
  surface: "#1e293b",       // slate-800

  // The darkest colour in the palette. This is the full-screen background
  // that sits behind everything else.
  background: "#0f172a",    // slate-900

  // Card background — intentionally the same as `surface` so decision cards
  // read as raised containers without heavy styling overhead.
  card: "#1e293b",

  // Subtle border colour used to visually separate cards, inputs, and sections
  // without being distracting on the dark background.
  border: "#334155",        // slate-700

  // ── Text ─────────────────────────────────────────────────────────────────────

  // Primary text — near-white so it's highly readable on the dark background.
  // Not pure white (#fff) because pure white on dark can cause eye strain.
  text: "#f1f5f9",          // slate-100

  // Muted / secondary text — used for timestamps, subtitles, placeholder text,
  // and other information that is less important than the main content.
  textMuted: "#94a3b8",     // slate-400

  // ── Semantic Status Colours ───────────────────────────────────────────────────

  // Green — used for success toasts and "owners" badges.
  success: "#22c55e",

  // Amber — used for warnings, rationale sections, and "unresolved questions"
  // indicators so users can spot decisions that still need attention.
  warning: "#f59e0b",

  // Red — used for error toasts, "risks accepted" badges, and delete actions.
  // Red universally signals "danger / attention required" in UI conventions.
  danger: "#ef4444",

  // ── Hermes Brand ─────────────────────────────────────────────────────────────

  // Violet is the dedicated colour for the Hermes AI agent — it appears on
  // the avatar, the send button in the Ask screen, and the app logo.
  // Using a distinct colour for Hermes makes it instantly clear which parts
  // of the UI belong to the AI vs the user.
  hermes: "#8b5cf6",        // violet-500 — Hermes brand colour
};
