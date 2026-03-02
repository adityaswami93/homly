"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/dashboard", label: "This Week", short: "Week" },
  { href: "/history",   label: "History",   short: "History" },
  { href: "/setup",     label: "Setup",     short: "Setup" },
  { href: "/settings",  label: "Settings",  short: "Settings" },
];

interface NavbarProps {
  user: { email?: string; user_metadata?: any } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname       = usePathname();
  const router         = useRouter();
  const isSuperAdmin   = user?.user_metadata?.is_super_admin === true;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const allNavItems = [
    ...NAV_ITEMS,
    ...(isSuperAdmin ? [{ href: "/admin", label: "Admin", short: "Admin" }] : []),
  ];

  return (
    <>
      {/* Desktop / tablet header */}
      <header className="border-b border-stone-800 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 bg-[#0f0e0c]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-amber-400 flex items-center justify-center">
              <span className="text-[11px] font-bold text-stone-900">H</span>
            </div>
            <span className="font-semibold tracking-tight text-stone-100">Homly</span>
          </div>
          <nav className="hidden sm:flex items-center gap-5 text-sm">
            {allNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`transition-colors ${
                  pathname === item.href
                    ? "text-amber-400"
                    : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
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
      </header>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-10 bg-[#0f0e0c]/95 backdrop-blur-sm border-t border-stone-800 flex justify-around py-2 pb-safe">
        {allNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[3rem] transition-colors ${
              pathname === item.href ? "text-amber-400" : "text-stone-500"
            }`}
          >
            <span className="text-[11px] font-medium">{item.short}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
