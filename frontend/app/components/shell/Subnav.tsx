"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
    <aside className="hidden lg:flex w-[200px] shrink-0 flex-col bg-white border-r border-gray-100 z-20">
      {/* App header */}
      <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-100">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: activeApp.accent, color: activeApp.color }}
        >
          <AppIcon icon={activeApp.icon} className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{activeApp.label}</p>
          <p className="text-xs text-gray-400 truncate">Household</p>
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
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
              style={isActive ? { backgroundColor: activeApp.color } : {}}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* WhatsApp connection status */}
      <div className="p-3 border-t border-gray-100">
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
            connected === true
              ? "bg-emerald-50 text-emerald-700"
              : connected === false
              ? "bg-red-50 text-red-600"
              : "bg-gray-50 text-gray-500"
          }`}
        >
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              connected === true
                ? "bg-emerald-500"
                : connected === false
                ? "bg-red-400"
                : "bg-gray-300"
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
