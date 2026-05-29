/*
 * app/(tabs)/_layout.tsx  —  Bottom Tab Bar Layout
 *
 * WHY THIS FILE EXISTS:
 * This file defines the bottom navigation tab bar that authenticated users
 * see at the bottom of the screen. It controls:
 *   - Which screens are accessible via the tab bar.
 *   - The icon and label for each tab.
 *   - The visual style of the tab bar (background colour, active/inactive colours).
 *
 * HOW IT FITS IN THE APP:
 * When a logged-in user opens the app, they land here (redirected by index.tsx).
 * The three tabs give them access to the three core features:
 *   1. Decisions (index)  — Browse all stored decisions.
 *   2. Ask Hermes (ask)   — Chat with the AI about past decisions.
 *   3. Add (add)          — Capture a new decision via text, file, or voice.
 *
 * WHY EXPO ROUTER TABS INSTEAD OF MANUAL NAVIGATION?
 * Expo Router's file-based routing means each file inside `app/(tabs)/`
 * automatically becomes a tab without any manual registration. The <Tabs>
 * component here just configures how those tabs look — the routing logic
 * is handled by the framework.
 *
 * THE "(tabs)" FOLDER NAME:
 * The parentheses are an Expo Router convention for "route groups".
 * A route group is a folder that organises screens without adding the folder
 * name to the URL. So `app/(tabs)/index.tsx` has the route path "/" (not "/tabs/"),
 * and `app/(tabs)/ask.tsx` has the path "/ask" (not "/tabs/ask").
 * This keeps URLs clean while still letting us organise screens into folders.
 */

import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";

/**
 * TabLayout
 *
 * Defines the bottom tab bar and registers the three tab screens.
 * Each <Tabs.Screen> corresponds to a file inside app/(tabs)/.
 *
 * The tab bar is styled to match the dark theme: surface-coloured background
 * with a subtle top border, using primary colour for the active tab icon.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        // Hide the built-in screen header — each tab screen manages its own
        // header area (or has none at all) via custom View styling.
        headerShown: false,

        // Style the tab bar to match the dark theme.
        // `surface` is one step lighter than the page background, which gives
        // the tab bar a subtle "floating panel" appearance.
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border, // Subtle top divider line
          height: 60,                    // Slightly taller than default for comfortable tapping
          paddingBottom: 8,             // Extra space at the bottom for devices with home indicators
        },

        // The active tab icon uses the primary brand colour — draws the eye
        // and shows the user where they currently are.
        tabBarActiveTintColor: Colors.primary,

        // Inactive tab icons use muted text so they don't compete with the active one.
        tabBarInactiveTintColor: Colors.textMuted,
      }}
    >
      {/* ── Tab 1: Decisions Feed ── */}
      {/* `name="index"` maps to the file app/(tabs)/index.tsx */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Decisions",
          tabBarIcon: ({ color, size }) => (
            // `library-outline` icon: represents a collection of stored items
            <Ionicons name="library-outline" size={size} color={color} />
          ),
        }}
      />

      {/* ── Tab 2: Ask Hermes ── */}
      {/* `name="ask"` maps to the file app/(tabs)/ask.tsx */}
      <Tabs.Screen
        name="ask"
        options={{
          title: "Ask Hermes",
          tabBarIcon: ({ color, size }) => (
            // Chat bubble icon: signals this is a conversation interface
            <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
          ),
        }}
      />

      {/* ── Tab 3: Add Decision ── */}
      {/* `name="add"` maps to the file app/(tabs)/add.tsx */}
      <Tabs.Screen
        name="add"
        options={{
          title: "Add",
          tabBarIcon: ({ color, size }) => (
            // Plus-in-circle icon: universally understood as "create something new"
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
