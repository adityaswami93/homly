"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apps, type App } from "@/config/apps";
import { AppIcon, SettingsIcon, MembersIcon } from "./icons";

interface RailProps {
  activeApp: App | null;
  user: { email?: string } | null;
}

export default function Rail({ activeApp, user }: RailProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const initials = user?.email?.charAt(0).toUpperCase() ?? "?";

  return (
    <aside className="hidden md:flex w-16 flex-col bg-[#111827] border-r border-gray-800 z-30 shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center justify-center shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg">
          <span className="text-sm font-bold text-gray-900">H</span>
        </div>
      </div>

      {/* App icons */}
      <nav className="flex-1 flex flex-col items-center gap-1 px-2 py-2">
        {apps.filter((a) => a.id !== "home").map((app) => {
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
                    ? "bg-gray-700/80"
                    : "text-gray-500 hover:text-gray-200 hover:bg-gray-800"
                }`}
                style={isActive ? { color: app.color } : {}}
                title={app.label}
              >
                <AppIcon icon={app.icon} className="w-5 h-5" />
              </Link>
              {/* Tooltip */}
              <div className="absolute left-14 top-1/2 -translate-y-1/2 hidden group-hover:block z-50 pointer-events-none">
                <div className="bg-gray-900 text-gray-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-gray-700">
                  {app.label}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom: platform actions */}
      <div className="flex flex-col items-center gap-1 px-2 py-3 border-t border-gray-800">
        <div className="relative group">
          <Link
            href="/expenses/members"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
            title="Members"
          >
            <MembersIcon className="w-5 h-5" />
          </Link>
          <div className="absolute left-14 bottom-0 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-gray-900 text-gray-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-gray-700">
              Members
            </div>
          </div>
        </div>
        <div className="relative group">
          <Link
            href="/settings"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
            title="Settings"
          >
            <SettingsIcon className="w-5 h-5" />
          </Link>
          <div className="absolute left-14 bottom-0 hidden group-hover:block z-50 pointer-events-none">
            <div className="bg-gray-900 text-gray-100 text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg border border-gray-700">
              Settings
            </div>
          </div>
        </div>
        {/* User avatar */}
        <button
          onClick={handleSignOut}
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-amber-500 to-amber-700 text-gray-900 font-bold text-sm hover:opacity-80 transition-opacity mt-1"
          title={`Sign out (${user?.email})`}
        >
          {initials}
        </button>
      </div>
    </aside>
  );
}
