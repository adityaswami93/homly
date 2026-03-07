"use client";

import { type App } from "@/config/apps";

interface TopbarProps {
  pageTitle: string;
  activeApp: App | null;
  user: { email?: string } | null;
  onSignOut: () => void;
}

export default function Topbar({ pageTitle, activeApp, user, onSignOut }: TopbarProps) {
  const initials = user?.email?.charAt(0).toUpperCase() ?? "?";

  return (
    <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-stone-800 bg-[#111827] shrink-0 z-10">
      <h1 className="text-base font-semibold text-stone-100 truncate">{pageTitle}</h1>

      <div className="flex items-center gap-3">
        {/* User email — hidden on mobile */}
        {user?.email && (
          <span className="hidden sm:block text-xs text-stone-500 truncate max-w-[180px]">
            {user.email}
          </span>
        )}

        {/* Sign out button */}
        <button
          onClick={onSignOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-stone-400 hover:text-stone-100 hover:bg-stone-800 border border-stone-700 hover:border-stone-600 transition-colors min-h-[36px]"
          title="Sign out"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h7a1 1 0 000-2H4V5h6a1 1 0 000-2H3zm11.293 4.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L15.586 12H9a1 1 0 010-2h6.586l-1.293-1.293a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
