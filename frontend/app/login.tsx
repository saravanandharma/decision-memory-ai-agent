/*
 * app/login.tsx  —  Login & Registration Screen
 *
 * WHY THIS FILE EXISTS:
 * This is the screen users see when they are not authenticated.
 * It handles two related flows in a single screen:
 *   1. Sign In  — existing users log in with email + password.
 *   2. Join Family — new users register with name, email, password,
 *                    and a family invite code.
 *
 * Combining both flows in one screen keeps the codebase small and avoids
 * navigating to a separate "Register" screen. The two modes are toggled
 * by simple tab buttons.
 *
 * HOW IT FITS IN THE APP:
 * The user arrives here from app/index.tsx (no stored token) or after
 * tapping "log out" in the Decisions feed. On successful login/register,
 * the JWT token is saved to AsyncStorage and the user is redirected to
 * the main tabs via router.replace("/(tabs)").
 *
 * WHY ASYNCSTORAGE FOR THE TOKEN?
 * AsyncStorage persists across app restarts (unlike in-memory state).
 * The user stays logged in until they explicitly log out or the token expires.
 * We also store `user_name` and `user_id` so other screens can show personalised
 * content without making an extra API call on every visit.
 *
 * ERROR DISPLAY CHOICE — INLINE BOX vs Alert.alert:
 * We use an inline error box instead of Alert.alert because on the web target
 * (Expo can build for web), Alert.alert uses the browser's native `alert()`
 * dialog which is blocking and easy to miss. An inline styled box is visible,
 * dismissable, and consistent across iOS, Android, and web.
 *
 * KEYBOARD HANDLING:
 * `KeyboardAvoidingView` shifts the form upward on iOS when the software
 * keyboard appears, so the input fields are never hidden beneath the keyboard.
 * The `behavior="padding"` mode is correct for iOS; Android handles this
 * natively via windowSoftInputMode so we pass `undefined` there.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Colors } from "@/constants/Colors";
import { login, register } from "@/services/api";

/**
 * LoginScreen
 *
 * Renders a form that handles both Sign In and Join Family (registration)
 * in a single component, toggled by the mode state.
 *
 * State:
 *   mode       - "login" or "register" — controls which fields are visible.
 *   name       - Only used in register mode; the user's display name.
 *   email      - Used in both modes.
 *   password   - Used in both modes.
 *   inviteCode - Only used in register mode; gates access to a family group.
 *   loading    - Tracks whether an API call is in progress, used to disable
 *                the button and show "Please wait…" text.
 *   error      - Holds the current error message, or "" if there is no error.
 */
export default function LoginScreen() {
  // `mode` controls which tab is active and which fields are shown.
  // Defaults to "login" because returning users are more common than new ones.
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  // `loading` prevents double-submission if the user taps the button twice
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * handleSubmit
   *
   * Validates the form fields, calls the appropriate API function
   * (login or register), stores the returned token and user info in
   * AsyncStorage, then navigates to the main app.
   *
   * On failure: shows a human-readable error message in the inline error box.
   *
   * WHY router.replace instead of router.push?
   * `replace` removes the login screen from the navigation stack.
   * If we used `push`, the user could press Back from the tabs and land
   * back on the login screen while already logged in — which would be confusing.
   */
  async function handleSubmit() {
    // Clear any previous error before starting a new attempt
    setError("");

    // ── Client-side validation ───────────────────────────────────────────────
    // Check required fields before making a network call, to give instant
    // feedback without waiting for a round-trip to the server.
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "register" && (!name || !inviteCode)) {
      setError("Name and invite code are required.");
      return;
    }

    // ── API call ─────────────────────────────────────────────────────────────
    setLoading(true);
    try {
      // Call the correct API function based on the current mode.
      // Both `login` and `register` return the same shape: { access_token, user_name, user_id }
      const data =
        mode === "login"
          ? await login(email, password)
          : await register(name, email, password, inviteCode);

      // Persist the token and user info to AsyncStorage so they survive app restarts.
      // We store `user_name` and `user_id` to avoid extra API calls elsewhere in the app.
      await AsyncStorage.setItem("token", data.access_token);
      await AsyncStorage.setItem("userName", data.user_name);
      await AsyncStorage.setItem("userId", data.user_id);

      // Navigate to the main tabs, replacing the login screen in the nav stack
      router.replace("/(tabs)");
    } catch (err: any) {
      // Try to extract the most useful error message, in order of specificity:
      //   1. The server's detailed error message (FastAPI sends these in `detail`)
      //   2. The generic axios/JS error message
      //   3. A fallback hint that the backend might not be running
      const msg =
        err?.response?.data?.detail ??
        err?.message ??
        "Cannot connect to server. Is the backend running on port 8000?";
      setError(msg);
    } finally {
      // Always reset loading, even if the request failed, so the button
      // becomes tappable again and doesn't stay stuck in a disabled state.
      setLoading(false);
    }
  }

  return (
    // KeyboardAvoidingView moves the form up when the keyboard appears on iOS.
    // `behavior="padding"` adds padding to the bottom of the view equal to the
    // keyboard height, which gently lifts the content without jarring jumps.
    // On Android we pass `undefined` because Android manages this automatically.
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ScrollView allows the form to be scrollable on small screens or when
          the keyboard is open. `keyboardShouldPersistTaps="handled"` ensures
          tapping the button while the keyboard is open works correctly — without
          this, a tap on the button would first dismiss the keyboard, requiring
          a second tap to actually submit. */}
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        {/* App branding header */}
        <View style={styles.header}>
          {/* The lightning bolt ⚡ is the Hermes visual brand symbol */}
          <Text style={styles.logo}>⚡ Hermes</Text>
          <Text style={styles.tagline}>Your family's decision memory</Text>
        </View>

        {/* Main form card */}
        <View style={styles.card}>
          {/* ── Mode toggle tabs ── */}
          {/* We render both tabs by mapping over the literal tuple so both
              options are always present and easy to extend in the future. */}
          <View style={styles.tabs}>
            {(["login", "register"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, mode === m && styles.tabActive]}
                // Switch mode and clear any error from the previous mode's attempt
                onPress={() => {
                  setMode(m);
                  setError("");
                }}
              >
                <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                  {/* Show friendlier labels than the raw mode strings */}
                  {m === "login" ? "Sign In" : "Join Family"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Register-only fields ── */}
          {/* These fields are conditionally rendered — they only appear when
              the user is in register mode. React Native unmounts them when
              mode switches back to login, which also clears their values. */}
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              // Capitalise each word automatically since this is a person's name
              autoCapitalize="words"
            />
          )}

          {/* ── Shared fields (both login and register) ── */}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address" // Shows the @ key on the keyboard
            autoCapitalize="none"        // Emails should never be capitalised
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry // Hides the typed characters behind dots
          />

          {/* ── Register-only: family invite code ── */}
          {mode === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Family invite code"
              placeholderTextColor={Colors.textMuted}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none" // Invite codes are typically lowercase
            />
          )}

          {/* ── Inline error box ── */}
          {/* Only rendered when there is an error message.
              We use an inline styled box instead of Alert.alert because:
              - On web, Alert.alert uses a blocking browser dialog.
              - Inline messages are part of the screen layout and easier to read.
              The "22" hex suffix adds ~13% opacity to the background (subtle tint).
              The "55" suffix adds ~33% opacity to the border (slightly more visible). */}
          {error !== "" && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ── Submit button ── */}
          {/* The button is visually dimmed (opacity 0.6) while loading and
              also set to `disabled` to prevent any tap events from firing. */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {/* Show contextual text based on current state and mode */}
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Join"}
            </Text>
          </TouchableOpacity>

          {/* ── Test credentials hint ── */}
          {/* Only shown in login mode to help developers and testers quickly
              sign in without needing to remember a test account.
              Should be removed or hidden in production. */}
          {mode === "login" && (
            <View style={styles.hint}>
              <Text style={styles.hintText}>
                Test account: test@family.com / test1234
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Full-screen dark background container
  container: { flex: 1, backgroundColor: Colors.background },

  // The ScrollView content is centred vertically with generous side padding
  inner: { flexGrow: 1, justifyContent: "center", padding: 24 },

  // Branding area above the card
  header: { alignItems: "center", marginBottom: 40 },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: Colors.hermes, // Violet brand colour for Hermes
    letterSpacing: 1,
  },
  tagline: { color: Colors.textMuted, marginTop: 8, fontSize: 15 },

  // The form card sits on the surface colour — slightly lighter than background
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 14, // `gap` in StyleSheet works like CSS flexbox gap — spaces children evenly
  },

  // Tab row: dark pill container holding both mode tabs
  tabs: {
    flexDirection: "row",
    backgroundColor: Colors.background, // Darker background makes active tab pop
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: Colors.primary }, // Active tab filled with brand colour
  tabText: { color: Colors.textMuted, fontWeight: "600" },
  tabTextActive: { color: "#fff" }, // White text on coloured active tab

  // Shared input styling
  input: {
    backgroundColor: Colors.background, // Darker than the card for contrast
    borderRadius: 10,
    padding: 14,
    color: Colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Error box: red-tinted background with a red border
  // The `+ "22"` appends a hex opacity code to the colour string.
  // "22" in hex = ~13% opacity. "55" in hex = ~33% opacity.
  errorBox: {
    backgroundColor: Colors.danger + "22",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.danger + "55",
  },
  errorText: { color: Colors.danger, fontSize: 13, lineHeight: 18 },

  // Primary action button
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 }, // Dim when disabled to signal non-interactive state
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  // Developer hint at the bottom of the login card
  hint: { alignItems: "center" },
  hintText: { color: Colors.textMuted, fontSize: 12 },
});
