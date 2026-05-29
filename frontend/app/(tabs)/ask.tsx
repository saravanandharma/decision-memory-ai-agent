/*
 * app/(tabs)/ask.tsx  —  Ask Hermes Chat Screen
 *
 * WHY THIS FILE EXISTS:
 * This screen is the conversational interface for querying the family's
 * decision history using natural language. The user types a question,
 * the Hermes AI agent searches the stored decisions and returns an answer.
 *
 * WHAT HERMES DOES (backend context):
 * Hermes is a multi-step reasoning agent. When it receives a question, it:
 *   1. Analyses the question to determine what to search for.
 *   2. Queries the vector database for semantically relevant decisions.
 *   3. Reads the retrieved decisions and synthesises an answer.
 *   4. Returns the answer + the list of source decisions it used.
 * All of this happens on the backend. The frontend just shows the result.
 *
 * HOW IT FITS IN THE APP:
 * This is Tab 2. It imports MessageBubble to render each chat message.
 * The conversation is local state — it is NOT persisted between app sessions.
 * Each time the user opens this tab, they start a fresh conversation.
 *
 * KEY UX DECISIONS:
 * 1. Suggestion chips are shown ONLY when the message list is empty.
 *    Once a conversation starts, the chips disappear to make room for messages.
 *    This "empty state with suggestions" pattern helps new users discover
 *    what kinds of questions they can ask.
 *
 * 2. A "Hermes is thinking…" indicator appears while the API call is in progress.
 *    This is important because Hermes's multi-step reasoning can take 3-10 seconds
 *    — without feedback, the user might think the app is frozen and tap again.
 *
 * 3. The input is multi-line so users can type longer questions comfortably.
 *    The send button is disabled while empty or loading to prevent empty/duplicate sends.
 *
 * 4. KeyboardAvoidingView + keyboardVerticalOffset=90 ensures the input bar
 *    stays above the keyboard when it opens on iOS. The offset accounts for the
 *    tab bar height (60px) plus some extra space.
 */

import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import { askHermes } from "@/services/api";
import MessageBubble from "@/components/MessageBubble";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Message
 *
 * Represents a single entry in the conversation history.
 *   id       - Unique identifier (timestamp-based string) used as the React list key.
 *   role     - "user" for messages the user sent, "hermes" for AI responses.
 *   text     - The message body text.
 *   sources  - (Hermes only) Decision records that Hermes cited in its answer.
 *              Each source has an `id` (UUID) and `title` (display string).
 *              Shown as a collapsible list below the Hermes bubble.
 *   thinking - (Hermes only) The intermediate reasoning steps Hermes took.
 *              Currently received from the backend but not yet displayed in the UI.
 */
type Message = {
  id: string;
  role: "user" | "hermes";
  text: string;
  sources?: { id: string; title: string }[];
  thinking?: string[];
};

// ── Suggestion Chips ──────────────────────────────────────────────────────────

/**
 * SUGGESTIONS
 *
 * Pre-written example questions shown as tappable chips when the conversation
 * is empty. Tapping a chip sends it immediately as a question.
 *
 * These cover the four most common use cases for the app:
 *   1. Understanding the rationale behind a past decision.
 *   2. Reviewing risks that were consciously accepted.
 *   3. Checking who disagreed with a decision (for follow-up).
 *   4. Surfacing hidden assumptions before making a related decision.
 */
const SUGGESTIONS = [
  "Why did we make that decision?",
  "What risks did we accept last month?",
  "Who opposed the last major choice?",
  "What assumptions are we relying on?",
];

/**
 * AskScreen
 *
 * The chat interface for querying the Hermes AI agent.
 *
 * State:
 *   messages - The conversation history. Array of Message objects, in order.
 *              Both user messages and Hermes responses are stored here.
 *   input    - The current text in the input field.
 *   loading  - True while waiting for Hermes's response (prevents double-sending).
 *
 * Refs:
 *   listRef  - Reference to the FlatList, used to programmatically scroll to
 *              the bottom after a new message is added.
 */
export default function AskScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // `listRef` lets us call `scrollToEnd()` on the FlatList programmatically.
  // This ensures newly arrived messages are immediately visible without
  // the user needing to scroll down manually.
  const listRef = useRef<FlatList>(null);

  /**
   * send
   *
   * Sends a question to the Hermes AI agent and appends both the user's
   * message and Hermes's response to the conversation.
   *
   * Flow:
   *   1. Trim and validate the question (ignore empty strings).
   *   2. Append the user's message to the list immediately (optimistic update).
   *   3. Call the API and wait for Hermes's response.
   *   4. Append Hermes's response (with sources and thinking steps).
   *   5. Scroll to the bottom of the list so the new message is visible.
   *
   * On error: appends a fallback error message from Hermes so the conversation
   * doesn't end on a blank response.
   *
   * @param text - The question to send (can come from the text input or a suggestion chip).
   */
  async function send(text: string) {
    const question = text.trim();
    // Do nothing if the question is empty or if another request is in flight
    if (!question || loading) return;

    // Clear the text input immediately so the user can start typing the next question
    setInput("");

    // Append the user's message to the conversation immediately.
    // We don't wait for the API — the user should see their own message right away.
    // Using Date.now().toString() as the ID is safe here because messages are only
    // created one at a time (the send button is disabled while loading).
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: question,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Start loading state — disables the send button and shows the thinking indicator
    setLoading(true);
    try {
      const res = await askHermes(question);

      // Build the Hermes response message from the API result.
      // `res.sources` is the list of decision records Hermes cited.
      // `res.thinking_steps` is the reasoning trace (currently received but not displayed).
      const hermesMsg: Message = {
        id: (Date.now() + 1).toString(), // +1 to avoid colliding with the user message ID
        role: "hermes",
        text: res.answer,
        sources: res.sources,
        thinking: res.thinking_steps,
      };
      setMessages((prev) => [...prev, hermesMsg]);
    } catch {
      // If the API call fails, show a friendly fallback message instead of crashing.
      // We still append a message so the conversation doesn't look broken.
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "hermes",
          text: "Sorry, I could not reach the server. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);

      // Scroll to the bottom after the new message is added.
      // The `setTimeout` gives React a tick to finish re-rendering the list
      // before we try to scroll — without it, scrollToEnd might not work
      // because the new message hasn't been laid out yet.
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    // KeyboardAvoidingView pushes the input bar above the keyboard on iOS.
    // `keyboardVerticalOffset={90}` accounts for the tab bar height (60px)
    // plus extra safe area padding so the input doesn't sit behind the keyboard.
    // We only need this on iOS — Android handles keyboard insets natively.
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        {/* Hermes avatar — the purple lightning bolt is the AI's visual identity.
            The "30" hex suffix gives the background ~19% opacity: a soft purple glow. */}
        <View style={styles.hermesBadge}>
          <Text style={styles.hermesIcon}>⚡</Text>
        </View>
        <View>
          <Text style={styles.title}>Hermes</Text>
          <Text style={styles.subtitle}>Ask anything about your decisions</Text>
        </View>
      </View>

      {/* ── Suggestion chips OR message list ── */}
      {/* This is a conditional render: show chips when the conversation is empty,
          switch to the message list as soon as the first message is sent.
          We use a simple ternary instead of showing both, because once a conversation
          starts the chips would just clutter the screen above the messages. */}
      {messages.length === 0 ? (
        // ── Empty state: suggestion chips ──
        <View style={styles.suggestions}>
          <Text style={styles.suggestLabel}>Try asking…</Text>
          {SUGGESTIONS.map((s) => (
            // Tapping a suggestion sends it directly — same as typing and pressing Send
            <TouchableOpacity key={s} style={styles.suggestion} onPress={() => send(s)}>
              <Ionicons
                name="sparkles-outline"
                size={14}
                color={Colors.hermes}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        // ── Active conversation: message list ──
        // `ref={listRef}` allows us to call scrollToEnd() after new messages arrive.
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          // Each message is a MessageBubble component that handles its own layout
          // (left-aligned for Hermes, right-aligned for user) and the collapsible sources.
          renderItem={({ item }) => <MessageBubble message={item} />}
        />
      )}

      {/* ── "Hermes is thinking…" indicator ── */}
      {/* Visible only while the API call is in progress.
          Without this, users might think the app has frozen during the 3-10 second
          wait while Hermes performs its multi-step reasoning. */}
      {loading && (
        <View style={styles.typing}>
          <ActivityIndicator size="small" color={Colors.hermes} />
          <Text style={styles.typingText}>Hermes is thinking…</Text>
        </View>
      )}

      {/* ── Input row ── */}
      <View style={styles.inputRow}>
        {/* Multi-line text input allows longer questions.
            `onSubmitEditing` fires when the user taps "Send" on the keyboard
            (only reliable when not multiline, but included as a convenience). */}
        <TextInput
          style={styles.input}
          placeholder="Ask about any decision…"
          placeholderTextColor={Colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={() => send(input)}
        />

        {/* Send button — disabled (and visually dimmed) when:
            - The input is empty (nothing to send)
            - A request is already in flight (prevent duplicate messages) */}
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!input.trim() || loading) && styles.sendBtnDisabled,
          ]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          {/* Filled arrow icon — universally understood as "send" in chat apps */}
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header: avatar + title side by side
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border, // Subtle separator between header and content
  },

  // Circular avatar badge for the Hermes lightning bolt icon.
  // `+ "30"` = hex 30 → ~19% opacity for the background colour tint.
  hermesBadge: {
    width: 42,
    height: 42,
    borderRadius: 21, // Half of width/height = perfect circle
    backgroundColor: Colors.hermes + "30",
    justifyContent: "center",
    alignItems: "center",
  },
  hermesIcon: { fontSize: 20 },
  title: { color: Colors.text, fontSize: 18, fontWeight: "700" },
  subtitle: { color: Colors.textMuted, fontSize: 12 },

  // Suggestion chips container
  suggestions: { padding: 24, gap: 10 },
  suggestLabel: { color: Colors.textMuted, fontSize: 13, marginBottom: 4 },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionText: { color: Colors.text, fontSize: 14, flex: 1 },

  // Message list — padded so bubbles don't touch the screen edges
  messageList: { padding: 16, paddingBottom: 8 },

  // "Thinking" indicator row
  typing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  typingText: { color: Colors.textMuted, fontSize: 13 },

  // Bottom input area — sits above the keyboard
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end", // Aligns send button to the bottom of the multi-line input
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface, // Slightly lighter than the page background
  },

  // Text input: flexible width, max height limits how tall it can grow
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    color: Colors.text,
    fontSize: 15,
    maxHeight: 100, // Caps the input height at ~4 lines before it starts scrolling
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Circular send button with Hermes brand colour
  sendBtn: {
    backgroundColor: Colors.hermes,
    width: 44,
    height: 44,
    borderRadius: 22, // Half = circle
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.4 }, // Very dim when disabled — clearly non-interactive
});
