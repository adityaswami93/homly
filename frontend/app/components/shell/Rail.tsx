"use client";

import Link from "next/link";
import { apps, type App } from "@/config/apps";
import { AppIcon, SettingsIcon, MembersIcon } from "./icons";

interface RailProps {
  activeApp: App | null;
  isSuperAdmin?: boolean;
}

export default function Rail({ activeApp, isSuperAdmin }: RailProps) {
  const visibleApps = apps.filter(
    (a) => a.id !== "home" && (!a.superAdminOnly || isSuperAdmin)
  );

  return (
    <aside className="hidden md:flex w-16 flex-col bg-[#111827] border-r border-stone-800 z-30 shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg">
          <span className="text-sm font-bold text-gray-900">H</span>
        </div>
      </div>

      {/* App icons */}
      <nav className="flex-1 flex flex-col items-center gap-1 px-2 py-2">
        {visibleApps.map((app) => {
          const isActive = activeApp?.id === app.id;
          return (
            <div key={app.id} className="relative w-full group">
              {/* Active indicator */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full"
                  style={{ backgroundColor: app.color }}
                />
              )}
              <Link
                href={app.href}
                className={`flex items-center justify-center w-10 h-10 rounded-xl mx-auto transition-all ${
                  isActive
                    ? "bg-stone-700/80"
                    : "text-stone-500 hover:text-stone-200 hover:bg-stone-800"
                }`}
                style={isActive ? { color: app.color } : {}}
                title={app.label}
              >
                <AppIcon icon={app.icon} className="w-5 h-5" />
              </Link>
              {/* Tooltip */}
              <div className="absolute left-14 top-1/2 -translate-y-1/2 hidden group-hover:block z-50 pointer-events-none">
                <div className="bg-stone-900 text-stone-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-stone-700">
                  {app.label}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: platform links */}
      <div className="flex flex-col items-center gap-1 px-2 py-3 border-t border-stone-800">
        <div className="relative group">
          <Link
            href="/expenses/members"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-all"
            title="Members"
          >
            <MembersIcon className="w-5 h-5" />
          </Link>
          <div className="absolute left-14 bottom-0 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-stone-900 text-stone-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-stone-700">
              Members
            </div>
          </div>
        </div>
        <div className="relative group">
          <Link
            href="/settings"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-all"
            title="Settings"
          >
            <SettingsIcon className="w-5 h-5" />
          </Link>
          <div className="absolute left-14 bottom-0 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-stone-900 text-stone-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-stone-700">
              Settings
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
