/*
 * app/_layout.tsx  —  Root Layout
 *
 * WHY THIS FILE EXISTS:
 * In Expo Router, the file `app/_layout.tsx` is the very first component that
 * mounts when the app opens. It wraps EVERY screen in the app and defines the
 * top-level navigation structure.
 *
 * This file sets up:
 *   1. The Stack navigator — the container that manages screen transitions
 *      (slide in, slide out, fade, etc.).
 *   2. Screen-level options — which screens show a header, what the header
 *      looks like, and what animation to use when navigating to them.
 *   3. The StatusBar style — so the clock/battery icons at the top of the
 *      phone are white (readable on our dark background).
 *
 * CRITICAL ARCHITECTURAL RULE — WHY AUTH REDIRECT IS NOT HERE:
 * You might expect the "is the user logged in?" check to live here, since
 * this is the first thing that runs. However, Expo Router requires that the
 * Root Layout ALWAYS renders a navigator (<Stack>) on its very first render.
 * If we tried to read AsyncStorage here and return early (before <Stack>
 * rendered), Expo Router would throw an error because no navigator was mounted.
 *
 * The solution: auth redirect lives in `app/index.tsx` using <Redirect />.
 * <Redirect> is safe because by the time index.tsx renders, <Stack> is already
 * mounted. See app/index.tsx for the full explanation.
 *
 * HOW IT FITS IN THE APP:
 * _layout.tsx  →  index.tsx (auth check + redirect)
 *              →  login.tsx  (if not logged in)
 *              →  (tabs)/_layout.tsx  (if logged in)
 *              →  decision/[id].tsx   (detail screen with back button)
 */

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Colors } from "@/constants/Colors";

/**
 * RootLayout
 *
 * The top-level layout component for the entire app.
 * Renders a Stack navigator that manages all screen transitions,
 * and sets the global status bar style to white text/icons.
 *
 * This component should remain as simple as possible — no state, no data
 * fetching, no conditional returns. Complexity belongs in individual screens.
 */
export default function RootLayout() {
  return (
    // The fragment (<>) lets us render both StatusBar and Stack as siblings
    // without adding an extra wrapping View to the layout tree.
    <>
      {/* Set status bar icons (time, battery, signal) to white so they're
          visible on our dark navy background. `style="light"` = white icons. */}
      <StatusBar style="light" />

      {/* Stack is the top-level navigator. It manages the "stack" of screens
          the user navigates through — pushing new screens on top, popping
          them off when they press Back.
          `headerShown: false` hides the default header on all screens.
          Individual screens override this option when they need a back button
          (see the decision/[id] screen below). */}
      <Stack screenOptions={{ headerShown: false }}>

        {/* The index screen is the app's entry point.
            It shows a loading spinner while it reads the auth token,
            then redirects to either (tabs) or login. */}
        <Stack.Screen name="index" />

        {/* (tabs) is a folder that contains its own _layout.tsx defining
            the bottom tab bar. All three main screens live inside it.
            The parentheses around "tabs" are an Expo Router convention —
            they mean the folder is a "route group" and the name itself is
            not part of the URL path. */}
        <Stack.Screen name="(tabs)" />

        {/* The login screen fades in instead of sliding, which feels more
            appropriate for an auth screen — it's not a forward/back navigation,
            it's a state transition (logged out → logged in). */}
        <Stack.Screen name="login" options={{ animation: "fade" }} />

        {/* The decision detail screen is the only screen with a visible header.
            It shows a back arrow automatically because it's a Stack screen
            pushed on top of the tabs. We style the header to match the dark theme. */}
        <Stack.Screen
          name="decision/[id]"
          options={{
            headerShown: true,       // Show the native header with a back button
            title: "Decision",       // Text displayed in the header
            headerStyle: { backgroundColor: Colors.background }, // Dark header background
            headerTintColor: Colors.text, // White back arrow and title text
          }}
        />
      </Stack>
    </>
  );
}
