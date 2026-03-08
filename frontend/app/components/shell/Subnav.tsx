"use client";

import Link from "next/link";
import { type App } from "@/config/apps";
import { AppIcon } from "./icons";

interface SubnavProps {
  activeApp: App | null;
  pathname: string;
  connected: boolean | null;
}

export default function Subnav({ activeApp, pathname, connected }: SubnavProps) {
  if (!activeApp) return null;

  return (
    <aside className="hidden lg:flex w-[200px] shrink-0 flex-col bg-[#1a1917] border-r border-stone-800 z-20">
      {/* App header */}
      <div className="h-14 flex items-center gap-3 px-4 border-b border-stone-800">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: activeApp.accent, color: activeApp.color }}
        >
          <AppIcon icon={activeApp.icon} className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-100 truncate">{activeApp.label}</p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-3 space-y-0.5">
        {activeApp.nav.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "text-white"
                  : "text-stone-400 hover:text-stone-100 hover:bg-stone-800"
              }`}
              style={isActive ? { backgroundColor: activeApp.color } : {}}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* WhatsApp connection status */}
      <div className="p-3 border-t border-stone-800">
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
            connected === true
              ? "bg-emerald-900/40 text-emerald-400"
              : connected === false
              ? "bg-red-900/40 text-red-400"
              : "bg-stone-800 text-stone-500"
          }`}
        >
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              connected === true
                ? "bg-emerald-500"
                : connected === false
                ? "bg-red-500"
                : "bg-stone-600"
            }`}
          />
          {connected === true
            ? "WhatsApp connected"
            : connected === false
            ? "WhatsApp offline"
            : "Checking…"}
        </div>
      </div>
    </aside>
  );
}
