/*
 * app/index.tsx  —  App Entry Point / Auth Gate
 *
 * WHY THIS FILE EXISTS:
 * This file is the first screen Expo Router renders after _layout.tsx mounts
 * the Stack navigator. Its sole job is to decide WHERE to send the user:
 *   - If a JWT token exists in storage → go to the main app (tabs)
 *   - If no token exists               → go to the login screen
 *
 * WHY AUTH REDIRECT LIVES HERE AND NOT IN _layout.tsx:
 * This is the most important architectural decision in the routing setup.
 *
 * Expo Router enforces a rule: the Root Layout (_layout.tsx) must render a
 * <Stack> (or other navigator) on its VERY FIRST render — no exceptions.
 * If _layout.tsx tried to check AsyncStorage first and returned a loading
 * spinner before rendering <Stack>, Expo Router would throw an error like:
 *   "Error: Attempted to navigate before mounting the Root Layout component."
 *
 * The safe pattern is:
 *   1. _layout.tsx always renders <Stack> immediately (no conditions).
 *   2. index.tsx (which loads INSIDE the already-mounted Stack) reads
 *      AsyncStorage and uses <Redirect> to navigate.
 *   3. <Redirect> is safe here because the Stack is already mounted by the
 *      time index.tsx renders — navigation is possible.
 *
 * WHY <Redirect> INSTEAD OF router.replace()?
 * router.replace() called during the initial render (outside useEffect) would
 * attempt navigation before the component is fully mounted — this can cause
 * race conditions. <Redirect> is a React component that schedules the
 * navigation as part of the render cycle, which is the safe approach.
 *
 * HOW IT FITS IN THE APP:
 * _layout.tsx mounts Stack  →  index.tsx runs  →  reads token from AsyncStorage
 *   → token found    →  <Redirect href="/(tabs)" />  →  user sees the feed
 *   → no token       →  <Redirect href="/login" />   →  user sees login screen
 */

import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Colors } from "@/constants/Colors";

/**
 * Index (App Entry Point)
 *
 * Reads the stored JWT token from AsyncStorage and redirects the user
 * to either the main tabs screen or the login screen.
 *
 * IMPORTANT: This component never actually "shows" anything to the user
 * for more than a brief moment — it's a routing decision point, not a
 * content screen. The spinner is only visible while AsyncStorage is being
 * read (usually < 100ms on real devices).
 *
 * State:
 *   token  - Three possible values, each meaning something different:
 *            `undefined` → still loading (haven't read AsyncStorage yet)
 *            `null`      → definitely no token (user is logged out)
 *            `string`    → token found (user is logged in)
 */
export default function Index() {
  // We use `undefined` as the initial value (not null or "") to represent
  // "we don't know yet" — a three-state system instead of two-state.
  // This lets us distinguish "loading" from "confirmed logged out".
  const [token, setToken] = useState<string | null | undefined>(undefined);

  // Read the JWT token from persistent storage when the component first mounts.
  // AsyncStorage.getItem returns: the string value if found, or null if not set.
  // We pass setToken directly as the callback — it handles both cases.
  useEffect(() => {
    AsyncStorage.getItem("token").then(setToken);
  }, []); // Empty dependency array = run once on mount, never again

  // While `token` is still `undefined`, AsyncStorage hasn't responded yet.
  // Show a loading spinner so the screen isn't blank during this brief moment.
  // We return early here but AFTER the Stack navigator has already mounted —
  // this is safe because _layout.tsx rendered <Stack> before index.tsx ran.
  if (token === undefined) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {/* Spinner uses the primary brand colour so it matches the overall theme */}
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  // At this point, token is either a string (logged in) or null (logged out).
  // <Redirect> replaces the current entry in the navigation history so the
  // user can't press Back and land on this loading screen again.
  //
  // `token` is truthy (non-empty string) → send to tabs
  // `token` is falsy (null)              → send to login
  return token ? <Redirect href="/(tabs)" /> : <Redirect href="/login" />;
}
