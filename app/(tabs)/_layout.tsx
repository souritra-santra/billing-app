import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, BorderRadius } from "../../src/constants/theme";
import { useLanguage } from "../../src/i18n";

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ITEMS: {
  name: string;
  titleKey: string;
  icon: IconName;
  iconFocused: IconName;
}[] = [
  { name: "index", titleKey: "tabs.home", icon: "grid-outline", iconFocused: "grid" },
  {
    name: "billing",
    titleKey: "tabs.billing",
    icon: "receipt-outline",
    iconFocused: "receipt",
  },
  {
    name: "inventory",
    titleKey: "tabs.stock",
    icon: "cube-outline",
    iconFocused: "cube",
  },
  {
    name: "customers",
    titleKey: "tabs.clients",
    icon: "people-outline",
    iconFocused: "people",
  },
  {
    name: "reports",
    titleKey: "tabs.reports",
    icon: "bar-chart-outline",
    iconFocused: "bar-chart",
  },
  {
    name: "history",
    titleKey: "tabs.history",
    icon: "time-outline",
    iconFocused: "time",
  },
];

export default function TabLayout() {
  const { t } = useLanguage();
  // Edge-to-edge Android draws the app under the system navigation bar, so the
  // tab bar must reserve the bottom safe-area inset or its icons get clipped.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          // Full bar height: 54px content + 8 top padding + 8 bottom + system inset.
          { height: 70 + insets.bottom, paddingBottom: 8 + insets.bottom },
        ],
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      {TAB_ITEMS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.titleKey),
            tabBarIcon: ({ focused, color }) => (
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Ionicons
                  name={focused ? tab.iconFocused : tab.icon}
                  size={22}
                  color={color}
                />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  tabItem: {
    gap: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: "rgba(108, 92, 231, 0.15)",
    borderRadius: BorderRadius.sm,
  },
});