/*
 * app/(tabs)/add.tsx  —  Add / Capture Decision Screen
 *
 * WHY THIS FILE EXISTS:
 * This screen lets users feed raw content to the Hermes backend for AI processing.
 * The backend's extraction pipeline reads unstructured input and pulls out
 * structured decision records — title, rationale, risks, alternatives, owners, etc.
 *
 * THREE INPUT MODES:
 * The screen supports three ways to provide content, all on the same screen:
 *
 *   1. TEXT  — Paste or type meeting notes, an email, a chat log, or a description.
 *              Hermes extracts any decisions it finds in the text.
 *
 *   2. FILE  — Upload a .txt, .md, or .pdf file. Useful for processing meeting
 *              minutes or architecture docs stored on the device.
 *
 *   3. RECORD — Record a voice note or meeting audio. The backend transcribes it
 *               using speech-to-text, then runs the same extraction pipeline.
 *
 * WHY ONE SCREEN INSTEAD OF THREE SEPARATE SCREENS?
 * All three modes share the same post-processing feedback (the Toast component)
 * and conceptually do the same thing — "capture something and extract decisions".
 * Having one screen with tabs avoids duplication and keeps the add flow cohesive.
 *
 * HOW IT FITS IN THE APP:
 * This is Tab 3. It calls `ingestText`, `ingestFile`, and `ingestAudio` from
 * services/api.ts. After successful ingestion, a Toast banner shows the names of
 * the newly created decisions so the user knows what was extracted.
 *
 * TOAST vs ALERT:
 * We use a custom Toast component instead of Alert.alert for success/warning
 * messages because:
 *   - On web, Alert.alert uses blocking browser dialogs which feel outdated.
 *   - Toasts auto-dismiss after 5 seconds — no interaction required for success.
 *   - Toasts can show a list of extracted decision titles inside the banner.
 *   - Error toasts do NOT auto-dismiss so the user can read the full error message.
 *
 * RECORDING TIMER:
 * A setInterval increments the recording duration counter every second.
 * We use useRef to hold the interval ID so we can clear it from stopRecording()
 * without causing a re-render when the ref is updated.
 */

import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Audio } from "expo-av";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import { ingestText, ingestFile, ingestAudio } from "@/services/api";

// ── Types ─────────────────────────────────────────────────────────────────────

/** The three input modes available on this screen. */
type Mode = "text" | "file" | "record";

/**
 * Toast
 *
 * The data needed to render a feedback banner at the top of the content area.
 *   type    - "success" (green), "warning" (amber), or "error" (red).
 *   message - The main feedback text (e.g. "2 decisions saved successfully.").
 *   titles  - (optional) List of extracted decision titles, shown as a sub-list
 *             inside the banner so the user can see what was captured.
 */
type Toast = {
  type: "success" | "warning" | "error";
  message: string;
  titles?: string[];
};

/**
 * AddScreen
 *
 * The main "capture" screen. Manages mode switching and delegates to
 * per-mode sections for the actual UI and logic.
 *
 * State:
 *   mode         - Which input mode is active ("text", "file", or "record").
 *   text         - The content of the text area in text mode.
 *   fileName     - The name of the selected file (shown in the upload area).
 *   recording    - The active Audio.Recording object while recording is in progress.
 *                  null when not recording.
 *   recordingUri - The local file URI of a completed recording, ready to upload.
 *                  null until the user stops recording.
 *   recordingSecs - Elapsed seconds for the recording timer display.
 *   loading      - True while an ingest API call is in progress.
 *   toast        - The current feedback banner data, or null if no banner is shown.
 *
 * Refs:
 *   timerRef   - Holds the setInterval ID for the recording timer so we can
 *                clear it when recording stops. Using a ref (not state) prevents
 *                unnecessary re-renders when the interval is created/cleared.
 *   toastTimer - Holds the setTimeout ID for auto-dismissing success/warning toasts.
 *                Stored in a ref so we can cancel the previous timer if a new toast
 *                arrives before the old one would have dismissed.
 */
export default function AddScreen() {
  // Current active input mode
  const [mode, setMode] = useState<Mode>("text");

  // ── Text mode state ──
  const [text, setText] = useState("");

  // ── File mode state ──
  // Stores the filename for display in the upload area while the file is processing
  const [fileName, setFileName] = useState<string | null>(null);

  // ── Record mode state ──
  // The active recording object from expo-av (null when not recording)
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  // The URI of a completed recording waiting to be uploaded (null until stopped)
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  // Elapsed recording time in seconds, shown as a MM:SS timer
  const [recordingSecs, setRecordingSecs] = useState(0);

  // `timerRef` holds the setInterval ID for the recording timer.
  // We use a ref (not state) because changing it should NOT trigger a re-render.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Shared state ──
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // `toastTimer` holds the setTimeout ID for auto-dismissing success/warning toasts.
  // Stored in a ref for the same reason as timerRef: we don't need a re-render
  // when the timer ID changes, we just need to be able to clear it.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * showToast
   *
   * Displays a feedback banner and sets up auto-dismissal for non-error toasts.
   *
   * WHY clear the previous timer first?
   * If a toast is already showing and the user triggers another action quickly,
   * we want the new toast's 5-second timer to start fresh. Without clearing the
   * old timer, the old timer could dismiss the NEW toast prematurely.
   *
   * Error toasts do NOT auto-dismiss — the user must manually close them by
   * tapping the X. This ensures they have time to read the full error message.
   *
   * @param t - The Toast data to display.
   */
  function showToast(t: Toast) {
    // Cancel any previous auto-dismiss timer before setting the new toast
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    // Only auto-dismiss success and warning toasts — errors stay until dismissed
    if (t.type === "success" || t.type === "warning") {
      toastTimer.current = setTimeout(() => setToast(null), 5000); // 5 seconds
    }
  }

  /**
   * clearMode
   *
   * Resets all mode-specific state to its initial values.
   * Called after a successful ingestion to prepare the screen for the next input.
   */
  function clearMode() {
    setText("");
    setFileName(null);
    setRecordingUri(null);
    setRecordingSecs(0);
  }

  // Cleanup: clear the auto-dismiss timer when the component unmounts.
  // This prevents a "can't update state on unmounted component" warning if
  // the user navigates away before the timer fires.
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ── Text Mode ─────────────────────────────────────────────────────────────────

  /**
   * submitText
   *
   * Sends the text area content to the backend for decision extraction.
   * Shows a success toast with the extracted decision titles if any were found,
   * or a warning toast if the AI found no decisions in the text.
   */
  async function submitText() {
    // Guard: don't submit if the input is blank or if already loading
    if (!text.trim() || loading) return;
    setLoading(true);
    setToast(null); // Clear any previous feedback before starting
    try {
      const results = await ingestText(text);
      if (results.length > 0) {
        // Clear the text area only on success — keep it if no decisions were found
        // so the user can refine their text and try again without retyping it
        setText("");
        showToast({
          type: "success",
          // Grammatically correct singular/plural: "1 decision" vs "3 decisions"
          message: `${results.length} decision${results.length > 1 ? "s" : ""} saved successfully.`,
          // Show the titles of extracted decisions so users can verify what was captured
          titles: results.map((d: any) => d.title),
        });
      } else {
        // The API returned an empty array — the AI found text but no decisions.
        // Guide the user with a hint about what makes a good decision description.
        showToast({
          type: "warning",
          message: "No decision found. Try including what was chosen and why.",
        });
      }
    } catch (err: any) {
      // `err?.response?.data?.detail` is the FastAPI error detail string.
      // Fall back to a generic message if the response doesn't have that shape.
      showToast({
        type: "error",
        message: err?.response?.data?.detail ?? "Failed to process text.",
      });
    } finally {
      setLoading(false);
    }
  }

  // ── File Mode ─────────────────────────────────────────────────────────────────

  /**
   * pickFile
   *
   * Opens the device's document picker, lets the user select a file,
   * then immediately uploads it to the backend for processing.
   * We only allow PDF, TXT, and Markdown files — the backend's parser
   * is not set up to handle other formats.
   *
   * WHY upload immediately after picking (instead of a separate "Upload" button)?
   * Once you've picked a file, there's nothing more to configure. The immediate
   * upload reduces the number of taps needed and makes the flow feel faster.
   */
  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      // Restrict to supported file types — presenting unsupported types would
      // just result in an error from the backend
      type: ["text/plain", "text/markdown", "application/pdf"],
    });
    // User dismissed the picker without selecting anything — do nothing
    if (result.canceled) return;

    // result.assets is an array but we only support single-file selection
    const asset = result.assets[0];
    setFileName(asset.name); // Show the filename in the upload area while processing
    setLoading(true);
    setToast(null);
    try {
      // `asset.mimeType` might be undefined on some platforms — fall back to plain text
      const results = await ingestFile(
        asset.uri,
        asset.name,
        asset.mimeType ?? "text/plain"
      );
      setFileName(null); // Clear filename after successful upload
      if (results.length > 0) {
        showToast({
          type: "success",
          message: `${results.length} decision${results.length > 1 ? "s" : ""} saved from "${asset.name}".`,
          titles: results.map((d: any) => d.title),
        });
      } else {
        showToast({
          type: "warning",
          message: "No decisions found in this file.",
        });
      }
    } catch (err: any) {
      showToast({
        type: "error",
        message: err?.response?.data?.detail ?? "Failed to process file.",
      });
    } finally {
      setLoading(false);
    }
  }

  // ── Record Mode ───────────────────────────────────────────────────────────────

  /**
   * startRecording
   *
   * Requests microphone permission, configures the audio session,
   * creates a new recording, and starts a timer to track elapsed time.
   *
   * WHY requestPermissionsAsync every time (not just on first use)?
   * Permissions can be revoked in device settings at any time between sessions.
   * Checking every time ensures we always handle the "permission was revoked" case.
   *
   * WHY setAudioModeAsync with allowsRecordingIOS + playsInSilentModeIOS?
   * On iOS, apps must explicitly opt into recording mode — it doesn't happen
   * automatically. `playsInSilentModeIOS` ensures the recording works even when
   * the physical mute switch is on (common in meetings where notifications are silenced).
   */
  async function startRecording() {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      // Show an error — no point continuing without microphone access
      showToast({
        type: "error",
        message: "Microphone permission is required to record.",
      });
      return;
    }
    // Configure iOS audio session for recording
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true, // Record even when device is on silent
    });
    // `HIGH_QUALITY` preset: 44.1kHz, stereo, AAC codec → M4A container.
    // This is a good balance between transcription quality and file size.
    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    setRecording(rec);
    setRecordingSecs(0); // Reset timer for the new recording

    // Start incrementing the timer display every second.
    // Using setInterval here (not a countdown) because we don't know how long
    // the user will record — it could be 10 seconds or 60 minutes.
    timerRef.current = setInterval(
      () => setRecordingSecs((s) => s + 1),
      1000
    );
  }

  /**
   * stopRecording
   *
   * Stops the active recording, saves the URI, and clears the timer.
   * After this, the UI shows a "Recording ready" state with an upload button.
   */
  async function stopRecording() {
    if (!recording) return;

    // Stop the elapsed-time counter
    clearInterval(timerRef.current!);

    // Stop and finalise the recording file
    await recording.stopAndUnloadAsync();

    // Get the local file URI of the saved recording for upload later
    setRecordingUri(recording.getURI());

    // Clear the active recording object — signals to the UI that we're no longer recording
    setRecording(null);
  }

  /**
   * submitRecording
   *
   * Uploads the completed recording to the backend for transcription and extraction.
   * Uses a timestamp-based filename because expo-av doesn't preserve the original name.
   */
  async function submitRecording() {
    if (!recordingUri || loading) return;
    setLoading(true);
    setToast(null);
    try {
      // Generate a unique filename using the current timestamp.
      // The `.m4a` extension tells the backend's parser this is AAC audio.
      const filename = `recording_${Date.now()}.m4a`;
      const results = await ingestAudio(recordingUri, filename);
      clearMode(); // Reset all state on success
      if (results.length > 0) {
        showToast({
          type: "success",
          message: `${results.length} decision${results.length > 1 ? "s" : ""} saved from recording.`,
          titles: results.map((d: any) => d.title),
        });
      } else {
        showToast({
          type: "warning",
          message: "No decisions found in the recording.",
        });
      }
    } catch (err: any) {
      showToast({
        type: "error",
        message: err?.response?.data?.detail ?? "Failed to process audio.",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * formatSecs
   *
   * Converts a total number of seconds into a "MM:SS" display string.
   * Used for the recording timer.
   *
   * `padStart(2, "0")` ensures single-digit numbers get a leading zero:
   * 5 seconds → "00:05", not "0:5".
   *
   * @param s - Total elapsed seconds.
   * @returns Formatted "MM:SS" string (e.g. "01:34").
   */
  function formatSecs(s: number) {
    return `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    // ScrollView so the content can be scrolled on small screens or when the
    // textarea is very large. `keyboardShouldPersistTaps="handled"` ensures
    // button taps work correctly when the keyboard is open.
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.inner}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Capture a Decision</Text>
      <Text style={styles.subtitle}>
        Write in any format — meeting notes, emails, casual descriptions.
        Hermes reads it and extracts the structure automatically.
      </Text>

      {/* ── Mode selector tabs ── */}
      {/* We map over a tuple of [modeValue, iconName, label] triples so adding
          a new mode in the future is a one-line change to this array. */}
      <View style={styles.modeRow}>
        {(
          [
            ["text", "create-outline", "Text"],
            ["file", "document-outline", "File"],
            ["record", "mic-outline", "Record"],
          ] as const
        ).map(([m, icon, label]) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeTab, mode === m && styles.modeTabActive]}
            // Switch mode and clear any active toast — it may not be relevant
            // to the new mode (e.g. "no decisions in this file" vs "no decisions in text")
            onPress={() => {
              setMode(m);
              setToast(null);
            }}
          >
            <Ionicons
              name={icon as any}
              size={18}
              color={mode === m ? "#fff" : Colors.textMuted}
            />
            <Text
              style={[styles.modeLabel, mode === m && styles.modeLabelActive]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Toast banner ── */}
      {/* The Toast is rendered ABOVE the mode-specific content but BELOW the mode tabs.
          This placement is shared by all three modes — only one ToastBanner component
          handles feedback for all three input types. */}
      {toast && <ToastBanner toast={toast} onDismiss={() => setToast(null)} />}

      {/* ── Text mode ── */}
      {mode === "text" && (
        <View style={styles.section}>
          {/* Hint text explains what kinds of input work and what doesn't.
              "Needs a real choice made" sets expectations: pure observations
              (e.g. "We discussed pricing") won't produce a decision record. */}
          <Text style={styles.hint}>
            Any format works. Examples:{"\n"}
            • "We went with Stripe over PayPal — John knows it well, Maria had fee concerns."{"\n"}
            • "Leadership approved a 4-day work week starting Q3."{"\n\n"}
            Tip: needs a real choice made. Pure observations won't save.
          </Text>

          {/* Multi-line textarea with a detailed placeholder showing an example.
              `textAlignVertical="top"` keeps the cursor at the top-left on Android
              (by default Android centres the text vertically in a multiline input). */}
          <TextInput
            style={styles.textarea}
            placeholder={
              'Paste meeting notes, an email, a chat snippet — or just describe what was decided and why.\n\nExample:\n"After debating React Native vs Flutter, we chose React Native. Our team already knows JavaScript and the timelines are tight. Flutter was faster but nobody knew Dart."'
            }
            placeholderTextColor={Colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
          />

          {/* Submit button: disabled when text is empty or loading */}
          <TouchableOpacity
            style={[styles.btn, (!text.trim() || loading) && styles.btnDisabled]}
            onPress={submitText}
            disabled={!text.trim() || loading}
          >
            {/* Show a spinner + "Extracting…" label while the API call is in progress */}
            {loading ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.btnText}>  Extracting…</Text>
              </>
            ) : (
              <Text style={styles.btnText}>Extract Decisions</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── File mode ── */}
      {mode === "file" && (
        <View style={styles.section}>
          <Text style={styles.hint}>
            Upload a .txt, .md, or .pdf file containing decisions or meeting
            notes.
          </Text>

          {/* The upload area is a large tappable zone — larger touch targets
              are easier to tap, especially for users unfamiliar with the app.
              The dashed border is a common visual convention for drop zones / upload areas. */}
          <TouchableOpacity
            style={styles.uploadArea}
            onPress={pickFile}
            disabled={loading} // Prevent picking a new file while one is processing
          >
            {loading ? (
              // While processing: show a spinner (file has been picked and sent)
              <>
                <ActivityIndicator color={Colors.primary} />
                <Text style={styles.uploadText}>Processing…</Text>
              </>
            ) : fileName ? (
              // File selected but not yet processed (brief window between pick and upload)
              <>
                <Ionicons name="document-text" size={40} color={Colors.primary} />
                <Text style={styles.uploadText}>{fileName}</Text>
                <Text style={styles.uploadSubtext}>Tap to choose a different file</Text>
              </>
            ) : (
              // No file selected yet: show the initial empty state
              <>
                <Ionicons
                  name="cloud-upload-outline"
                  size={40}
                  color={Colors.textMuted}
                />
                <Text style={styles.uploadText}>Tap to select a file</Text>
                <Text style={styles.uploadSubtext}>.txt · .md · .pdf</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Record mode ── */}
      {mode === "record" && (
        <View style={styles.section}>
          <Text style={styles.hint}>
            Record a meeting or voice note. Hermes will transcribe and extract
            decisions.
          </Text>

          {/* ── State 1: No recording yet ── */}
          {/* Show the "Start Recording" button before any recording has been made */}
          {!recording && !recordingUri && (
            <TouchableOpacity style={styles.recordBtn} onPress={startRecording}>
              <Ionicons name="mic" size={32} color="#fff" />
              <Text style={styles.recordBtnText}>Start Recording</Text>
            </TouchableOpacity>
          )}

          {/* ── State 2: Recording in progress ── */}
          {/* Show an animated red dot (pulsing by convention), the MM:SS timer,
              and a Stop button. The red dot matches the universal recording indicator. */}
          {recording && (
            <View style={styles.recording}>
              {/* Red dot: universally understood as "recording" indicator */}
              <View style={styles.recordingDot} />
              {/* Large timer display — easy to read at a glance during a meeting */}
              <Text style={styles.recordingTime}>{formatSecs(recordingSecs)}</Text>
              <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
                <Ionicons name="stop" size={28} color="#fff" />
                <Text style={styles.stopBtnText}>Stop</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── State 3: Recording stopped, ready to upload ── */}
          {/* Show the completed duration and give the user two options:
              upload it, or discard and start over. */}
          {recordingUri && !recording && (
            <View style={styles.recorded}>
              <Ionicons name="mic-circle" size={48} color={Colors.primary} />
              {/* Show the final duration so the user can confirm this is the right take */}
              <Text style={styles.recordedText}>
                Recording ready · {formatSecs(recordingSecs)}
              </Text>

              <TouchableOpacity
                style={[
                  styles.btn,
                  { alignSelf: "stretch" }, // Stretch to full width in this context
                  loading && styles.btnDisabled,
                ]}
                onPress={submitRecording}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.btnText}>  Extracting…</Text>
                  </>
                ) : (
                  <Text style={styles.btnText}>Extract Decisions</Text>
                )}
              </TouchableOpacity>

              {/* Discard link: red text signals this is a destructive action,
                  but it's presented as a plain text link (not a button) so it
                  doesn't draw as much attention as the primary "Extract" action. */}
              <TouchableOpacity
                onPress={() => {
                  setRecordingUri(null);
                  setRecordingSecs(0);
                  setToast(null);
                }}
              >
                <Text style={styles.discardText}>Discard recording</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

// ── Toast Banner Component ─────────────────────────────────────────────────────

/**
 * ToastBanner
 *
 * A feedback banner displayed after an ingest action completes.
 * Shared by all three input modes (text, file, record).
 *
 * The banner colour adapts to the toast type:
 *   success → green    warning → amber    error → red
 *
 * WHY a separate component instead of inline JSX?
 * The ToastBanner has its own logic (colour calculation, icon selection) that
 * would clutter the main AddScreen render if inlined. A small separate component
 * keeps the main render clean and makes the toast easy to find and modify.
 *
 * @param toast     - The toast data to display (type, message, optional titles).
 * @param onDismiss - Callback called when the user taps the X close button.
 */
function ToastBanner({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const isSuccess = toast.type === "success";
  const isWarning = toast.type === "warning";

  // Pick a semantic colour based on the toast type
  const color = isSuccess
    ? Colors.success
    : isWarning
    ? Colors.warning
    : Colors.danger;

  // Pick an icon that reinforces the meaning of the status
  const icon = isSuccess
    ? "checkmark-circle"
    : isWarning
    ? "warning"
    : "close-circle";

  return (
    // The background and border use hex colour + opacity suffix:
    // "18" = ~9.4% opacity background (very subtle tint)
    // "55" = ~33% opacity border (noticeable but not heavy)
    <View
      style={[
        styles.toast,
        { borderColor: color + "55", backgroundColor: color + "18" },
      ]}
    >
      {/* ── Main message row: icon + text + close button ── */}
      <View style={styles.toastHeader}>
        <Ionicons name={icon as any} size={18} color={color} />
        {/* `flex: 1` makes the message text take up all available width,
            leaving room for the icon and close button */}
        <Text style={[styles.toastMessage, { color }]}>{toast.message}</Text>
        {/* Close button: `hitSlop={8}` expands the tappable area by 8px on each side
            without changing the visible size — makes small buttons easier to tap */}
        <TouchableOpacity onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={16} color={color} />
        </TouchableOpacity>
      </View>

      {/* ── Extracted decision titles ── */}
      {/* Only shown if the ingest returned a non-empty list of decisions.
          Each title is shown with a document icon so users can see at a glance
          what decisions were captured from their input. */}
      {toast.titles && toast.titles.length > 0 && (
        <View style={styles.toastTitles}>
          {toast.titles.map((t, i) => (
            <View key={i} style={styles.toastTitleRow}>
              <Ionicons
                name="document-text-outline"
                size={13}
                color={Colors.textMuted}
              />
              {/* `numberOfLines={1}` truncates very long titles with "…" so the
                  toast doesn't become excessively tall */}
              <Text style={styles.toastTitleText} numberOfLines={1}>
                {t}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: {
    padding: 24,
    paddingTop: 64, // Extra top padding to clear the device status bar
    gap: 0,
  },
  title: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },

  // Mode selector: three equally-sized tabs in a row
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  modeTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // Active mode tab: filled with primary brand colour
  modeTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeLabel: { color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
  modeLabelActive: { color: "#fff" },

  // Toast banner
  toast: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  toastHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  toastMessage: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  toastTitles: { gap: 6, paddingLeft: 4 },
  toastTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toastTitleText: { color: Colors.textMuted, fontSize: 12, flex: 1 },

  section: { gap: 16 },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 19 },

  // Multi-line text area
  textarea: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    color: Colors.text,
    fontSize: 15,
    minHeight: 200, // Ensures a comfortable minimum height for writing
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Primary action button (used in both text and record modes)
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  // File upload drop zone
  uploadArea: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: "dashed", // Dashed border: visual convention for "droppable / uploadable area"
    paddingVertical: 60,
    alignItems: "center",
    gap: 10,
  },
  uploadText: { color: Colors.text, fontSize: 16, fontWeight: "600" },
  uploadSubtext: { color: Colors.textMuted, fontSize: 13 },

  // Recording start button
  recordBtn: {
    backgroundColor: Colors.danger, // Red = recording / danger
    borderRadius: 16,
    paddingVertical: 40,
    alignItems: "center",
    gap: 10,
  },
  recordBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },

  // Active recording display area
  recording: { alignItems: "center", gap: 20, paddingVertical: 30 },
  // The classic red blinking dot that means "recording in progress"
  recordingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.danger,
  },
  // Large, thin font makes the timer easy to read without being distracting
  // `tabular-nums` ensures each digit takes up the same width so the timer
  // doesn't "jump" as the seconds change (e.g. "09" → "10" doesn't shift layout)
  recordingTime: {
    color: Colors.text,
    fontSize: 48,
    fontWeight: "200",
    fontVariant: ["tabular-nums"],
  },
  stopBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 40,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stopBtnText: { color: Colors.text, fontSize: 16, fontWeight: "600" },

  // Post-recording "ready to upload" state
  recorded: { alignItems: "center", gap: 14, paddingVertical: 20 },
  recordedText: { color: Colors.text, fontSize: 15 },
  // "Discard" as a plain red text link — destructive but not as prominent as a button
  discardText: { color: Colors.danger, fontSize: 14 },
});
