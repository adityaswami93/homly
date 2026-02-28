"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Research" },
  { href: "/earnings", label: "Earnings" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/settings", label: "Settings" },
];

interface NavbarProps {
  user: { email?: string } | null;
  isAdmin?: boolean;
  children?: React.ReactNode;
}

export default function Navbar({ user, isAdmin, children }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <header className="border-b border-white/5 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 bg-[#080808]/90 backdrop-blur-sm z-10">
      <div className="flex items-center gap-4 md:gap-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold tracking-tight">Finclaro</span>
          <span className="text-xs text-white/20 border border-white/10 px-2 py-0.5 rounded-full hidden sm:block">
            Beta
          </span>
        </div>
        <nav className="hidden sm:flex items-center gap-4 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`transition ${
                pathname === item.href
                  ? "text-white"
                  : "text-white/40 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              href="/admin"
              className={`transition ${
                pathname === "/admin"
                  ? "text-white"
                  : "text-white/40 hover:text-white"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {children}
        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hidden md:flex">
          <span className="text-xs text-white/60 font-medium">
            {user?.email?.charAt(0).toUpperCase()}
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm text-white/40 hover:text-white transition"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
