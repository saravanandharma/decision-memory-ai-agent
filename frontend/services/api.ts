/*
 * services/api.ts
 *
 * WHY THIS FILE EXISTS:
 * This is the single place where ALL network calls to the backend live.
 * Centralising API calls here means:
 *   1. Every screen imports from one file — no duplicated fetch/axios logic.
 *   2. Auth headers (the JWT token) are attached automatically via an
 *      axios "interceptor", so individual screens never have to think about it.
 *   3. If the backend URL ever changes, you update it in exactly one place.
 *
 * HOW IT FITS IN THE APP:
 * Screens import individual functions (e.g. `listDecisions`, `askHermes`)
 * from this file. Those functions make HTTP requests to the FastAPI backend,
 * and return the parsed JSON response directly.
 *
 * TECHNOLOGY CHOICES:
 * - axios (instead of fetch): axios automatically throws errors for non-2xx
 *   responses, parses JSON for you, and has a clean interceptor API for
 *   injecting headers. fetch requires more boilerplate to do the same things.
 * - AsyncStorage (instead of in-memory): The JWT token must survive app
 *   restarts. AsyncStorage persists to device storage, so the user stays
 *   logged in even after closing and reopening the app.
 * - expo-constants: Lets us read the API URL from app.json's `extra` field
 *   at build time, so you can set a different URL per environment (dev/prod)
 *   without hardcoding it in source code.
 */

import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

// ── API Base URL ───────────────────────────────────────────────────────────────
//
// Where to find the backend server. Priority order:
//   1. app.json extra.apiUrl  — set this for production / staging builds
//   2. http://localhost:8000   — fallback for local development on iOS Simulator
//                                (Android Emulator needs http://10.0.2.2:8000 instead)
//
// Example app.json snippet:
//   "extra": { "apiUrl": "https://your-app.railway.app" }
//
// The "as string" cast tells TypeScript this value is definitely a string,
// not an unknown type. The ?? operator means "use the fallback if the left
// side is null or undefined".
const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:8000";

// ── Axios Instance ─────────────────────────────────────────────────────────────
//
// We create a dedicated axios instance (rather than using `axios` directly) so
// that the baseURL and any interceptors are scoped to our app's API calls only.
// This prevents accidental interference if a library also uses axios globally.
const api = axios.create({ baseURL: API_URL });

// ── Request Interceptor — Attach JWT Token ─────────────────────────────────────
//
// This function runs BEFORE every request the app sends.
// It reads the JWT token from AsyncStorage and, if one exists, adds it to the
// Authorization header so the backend can verify the user's identity.
//
// WHY an interceptor instead of passing the token manually in each function?
// Because forgetting to pass the token would be an easy mistake, and there are
// many API functions. The interceptor guarantees the header is always there.
//
// The header format `Bearer <token>` is the industry-standard way to send JWTs
// in HTTP requests. The backend's auth middleware expects this exact format.
api.interceptors.request.use(async (config) => {
  // Read the stored JWT token. Returns null if not yet logged in.
  const token = await AsyncStorage.getItem("token");
  // Only attach the header when we actually have a token.
  // Unauthenticated requests (like /auth/login) will simply not have this header.
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auth ─────────────────────────────────────────────────────────────────────
//
// These functions handle user identity: creating accounts and signing in.

/**
 * Registers a new user account and joins an existing family group.
 *
 * @param name       - The user's display name (shown in the app header).
 * @param email      - Login email address.
 * @param password   - Chosen password (hashed server-side; never stored in plain text).
 * @param inviteCode - A family-specific code that gates who can join the family group.
 *                     This prevents strangers from accessing private family decisions.
 * @returns The API response containing `access_token`, `user_name`, and `user_id`.
 */
export async function register(
  name: string,
  email: string,
  password: string,
  inviteCode: string
) {
  // Note: the backend field is `invite_code` (snake_case) while the frontend
  // uses `inviteCode` (camelCase). We map between them here so the rest of
  // the app can use JavaScript naming conventions consistently.
  const { data } = await api.post("/auth/register", {
    name,
    email,
    password,
    invite_code: inviteCode,
  });
  return data;
}

/**
 * Signs in an existing user with email and password.
 *
 * @param email    - The user's registered email address.
 * @param password - The user's password (sent over HTTPS; never logged).
 * @returns The API response containing `access_token`, `user_name`, and `user_id`.
 *
 * After calling this, the caller is responsible for storing `access_token`
 * in AsyncStorage so subsequent API calls are authenticated.
 */
export async function login(email: string, password: string) {
  const { data } = await api.post("/auth/login", { email, password });
  return data;
}

/**
 * Fetches the profile of the currently logged-in user.
 *
 * @returns User object (id, name, email, family_id, etc.).
 *
 * Uses the JWT from AsyncStorage (attached automatically by the interceptor).
 * This is useful for confirming the token is still valid, or for showing
 * user-specific info without reading it from AsyncStorage directly.
 */
export async function getMe() {
  const { data } = await api.get("/auth/me");
  return data;
}

// ── Decisions ────────────────────────────────────────────────────────────────
//
// CRUD operations for the decision records stored in the database.
// Each decision is an AI-extracted structured record containing a title,
// summary, rationale, risks, alternatives, owners, and more.

/**
 * Returns a paginated list of decisions belonging to the current user's family.
 *
 * @param limit  - Maximum number of decisions to return (default 50).
 * @param offset - How many decisions to skip (for pagination). Default 0.
 * @returns Array of decision objects, sorted newest-first by the backend.
 *
 * WHY pagination? Families can accumulate hundreds of decisions over time.
 * Returning all of them at once would be slow and waste mobile data.
 * We default to 50 which is enough for the initial screen without pagination UI.
 */
export async function listDecisions(limit = 50, offset = 0) {
  const { data } = await api.get("/decisions", { params: { limit, offset } });
  return data;
}

/**
 * Fetches the full detail of a single decision by its unique ID.
 *
 * @param id - The UUID of the decision (comes from the URL parameter in decision/[id].tsx).
 * @returns A single decision object with all fields populated.
 *
 * The list endpoint may return abbreviated data for performance reasons.
 * The detail endpoint always returns the complete record.
 */
export async function getDecision(id: string) {
  const { data } = await api.get(`/decisions/${id}`);
  return data;
}

/**
 * Permanently deletes a decision from the database.
 *
 * @param id - The UUID of the decision to delete.
 * @returns Confirmation object from the backend.
 *
 * This is an irreversible action — there is no recycle bin.
 * The UI shows a confirmation dialog before calling this function.
 */
export async function deleteDecision(id: string) {
  const { data } = await api.delete(`/decisions/${id}`);
  return data;
}

// ── Ingest ───────────────────────────────────────────────────────────────────
//
// These functions send raw content to the backend for AI processing.
// The backend uses an LLM to extract structured decision records from
// unstructured inputs like meeting notes, documents, or voice recordings.
// The user does not need to format their input in any special way.

/**
 * Sends a plain-text string to the backend for decision extraction.
 *
 * @param rawText    - Free-form text: meeting notes, email copy, a description, etc.
 * @param sourceType - Hints to the backend where the text came from (default "text").
 *                     Other values include "email", "chat". Used for the source icon
 *                     shown on DecisionCard.
 * @param sourceRef  - Optional URL or reference string (e.g. a Notion page URL).
 * @returns Array of newly created decision objects extracted from the text.
 *          Empty array means the backend found no decisions in the input.
 */
export async function ingestText(rawText: string, sourceType = "text", sourceRef?: string) {
  const { data } = await api.post("/ingest/text", {
    raw_text: rawText,    // snake_case because the FastAPI Pydantic model expects it
    source_type: sourceType,
    source_ref: sourceRef,
  });
  return data;
}

/**
 * Uploads a document file (PDF, TXT, or Markdown) for decision extraction.
 *
 * @param uri      - The local file URI on the device (provided by expo-document-picker).
 * @param name     - The original filename (e.g. "meeting-notes.pdf").
 * @param mimeType - The file's MIME type (e.g. "application/pdf", "text/plain").
 * @returns Array of newly created decision objects extracted from the document.
 *
 * WHY FormData? Binary files cannot be sent as JSON. FormData is the standard
 * way to upload files over HTTP — it's the same mechanism a web form uses.
 * The `as any` cast is needed because React Native's FormData.append() accepts
 * an object with `{uri, name, type}`, which TypeScript doesn't know about by
 * default (it's a React Native extension of the web FormData spec).
 */
export async function ingestFile(uri: string, name: string, mimeType: string) {
  const form = new FormData();
  // React Native specific: pass an object with uri/name/type instead of a Blob
  form.append("file", { uri, name, type: mimeType } as any);
  const { data } = await api.post("/ingest/file", form, {
    // Override the default Content-Type so axios sends multipart/form-data
    // with the correct boundary string (generated automatically by the browser/RN runtime)
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/**
 * Uploads an audio recording (M4A format) for transcription and decision extraction.
 *
 * @param uri  - The local file URI of the recorded audio (from expo-av).
 * @param name - A generated filename for the recording (e.g. "recording_1716900000000.m4a").
 * @returns Array of newly created decision objects extracted from the transcription.
 *
 * The backend first transcribes the audio using a speech-to-text model,
 * then runs the same decision extraction pipeline as ingestText.
 * M4A is the format produced by expo-av's HIGH_QUALITY preset on iOS.
 */
export async function ingestAudio(uri: string, name: string) {
  const form = new FormData();
  // Hard-code audio/m4a because expo-av always records in M4A format
  form.append("file", { uri, name, type: "audio/m4a" } as any);
  const { data } = await api.post("/ingest/audio", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// ── Query (Hermes) ────────────────────────────────────────────────────────────
//
// The Hermes agent is the AI reasoning engine. When you ask it a question,
// it performs a multi-step reasoning loop: it searches the decision database,
// retrieves relevant records, and synthesises a natural-language answer.
// The frontend simply sends the question and displays whatever the backend returns.

/**
 * Sends a natural-language question to the Hermes AI agent and returns its answer.
 *
 * @param question - Any plain English question about the family's decision history.
 *                   Examples: "Why did we choose React Native?",
 *                             "What risks did we accept in Q1?"
 * @returns An object with:
 *   - `answer`         {string}   - Hermes's natural-language response.
 *   - `sources`        {Array}    - List of decision records that Hermes cited,
 *                                   each with `id` and `title`. Used by MessageBubble
 *                                   to show a collapsible "sources" section so the
 *                                   user can verify the answer.
 *   - `thinking_steps` {string[]} - The intermediate reasoning steps Hermes took
 *                                   (useful for debugging or curious users).
 *
 * WHY does the frontend not need to know HOW Hermes reasons?
 * The multi-step retrieval and reasoning loop runs entirely on the backend.
 * Keeping it server-side means the heavy LLM computation doesn't run on the
 * user's phone, and the reasoning logic can be improved without app updates.
 */
export async function askHermes(question: string) {
  const { data } = await api.post("/query", { question });
  return data;
}

// Export the raw axios instance in case any screen needs direct access
// (e.g. for custom requests not covered by the helper functions above).
export default api;
