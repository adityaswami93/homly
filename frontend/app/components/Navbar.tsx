"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useState } from "react";
import config from "@/lib/config";

const NAV_ITEMS = [
  { href: "/dashboard",      label: "This Week"  },
  { href: "/analytics",      label: "Analytics"  },
  { href: "/reimbursements", label: "Reimburse"  },
  { href: "/insights",       label: "Insights"   },
  { href: "/history",        label: "History"    },
  { href: "/settings",       label: "Settings"   },
];

interface NavbarProps {
  user: { email?: string; user_metadata?: any } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname     = usePathname();
  const router       = useRouter();
  const isSuperAdmin = user?.user_metadata?.is_super_admin === true;
  const [menuOpen,   setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const allNav = [
    ...NAV_ITEMS,
    ...(isSuperAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="border-b border-stone-800 sticky top-0 bg-[#0f0e0c]/90 backdrop-blur-sm z-10">
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-10 py-3.5 flex items-center justify-between">

        {/* Logo + Desktop nav */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center">
              <span className="text-[11px] font-bold text-white">H</span>
            </div>
            <span className="font-semibold tracking-tight text-stone-100">
              {config.appName}
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {allNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  pathname === item.href
                    ? "bg-stone-800 text-stone-100"
                    : "text-stone-400 hover:text-stone-200 hover:bg-stone-900"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center">
              <span className="text-xs text-stone-400 font-medium">
                {user?.email?.charAt(0).toUpperCase()}
              </span>
            </div>
            <button
              onClick={handleSignOut}
              className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
            >
              Sign out
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-200"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-stone-800 bg-[#0f0e0c] px-4 py-3 space-y-1">
          {allNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`block px-3 py-2.5 rounded-lg text-sm transition-colors ${
                pathname === item.href
                  ? "bg-stone-800 text-stone-100"
                  : "text-stone-400 hover:text-stone-200 hover:bg-stone-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-stone-800 mt-2">
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-3 py-2.5 text-sm text-stone-500 hover:text-stone-300"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
