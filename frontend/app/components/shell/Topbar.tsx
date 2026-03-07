"use client";

import { type App } from "@/config/apps";

interface TopbarProps {
  pageTitle: string;
  activeApp: App | null;
  onAction?: () => void;
  actionLabel?: string;
}

export default function Topbar({ pageTitle, activeApp, onAction, actionLabel }: TopbarProps) {
  return (
    <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-gray-100 bg-white shrink-0 z-10">
      <h1 className="text-base font-semibold text-gray-900 truncate">{pageTitle}</h1>
      <div className="flex items-center gap-3">
        {/* Search — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="search"
            placeholder="Search…"
            className="w-32 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
        {/* Contextual action */}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-colors min-h-[36px]"
            style={activeApp ? { backgroundColor: activeApp.color } : { backgroundColor: "#6B7280" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">{actionLabel}</span>
          </button>
        )}
      </div>
    </header>
  );
}
