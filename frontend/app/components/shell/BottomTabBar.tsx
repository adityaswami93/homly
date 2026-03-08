"use client";

import Link from "next/link";
import { apps, type App } from "@/config/apps";
import { AppIcon, SettingsIcon } from "./icons";

interface BottomTabBarProps {
  activeApp: App | null;
  isSuperAdmin?: boolean;
}

export default function BottomTabBar({ activeApp, isSuperAdmin }: BottomTabBarProps) {
  const tabApps = apps.filter((a) => a.id !== "home" && (!a.superAdminOnly || isSuperAdmin));

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-[#111827] border-t border-stone-800 z-40 flex items-end"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-around w-full min-h-[56px]">
        {tabApps.map((app) => {
          const isActive = activeApp?.id === app.id;
          return (
            <Link
              key={app.id}
              href={app.href}
              className="flex flex-col items-center justify-center gap-0.5 py-2 flex-1 min-h-[56px] min-w-[44px] transition-colors"
              style={isActive ? { color: app.color } : { color: "#6B7280" }}
            >
              <AppIcon icon={app.icon} className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">{app.label}</span>
            </Link>
          );
        })}
        <Link
          href="/settings"
          className="flex flex-col items-center justify-center gap-0.5 py-2 flex-1 min-h-[56px] min-w-[44px] transition-colors"
          style={activeApp === null ? { color: "#9CA3AF" } : { color: "#6B7280" }}
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="text-[10px] font-medium leading-none">Settings</span>
        </Link>
      </div>
    </nav>
  );
}
