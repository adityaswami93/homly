"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function IconWeek({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14" />
      <path d="M7 2v3M13 2v3" />
      <path d="M7 12h2M11 12h2M7 15h2" />
    </svg>
  );
}

function IconHistory({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 10A6.5 6.5 0 1 0 10 3.5" />
      <path d="M3.5 6V10h3.5" />
      <path d="M10 7v3.5l2.5 1.5" />
    </svg>
  );
}

function IconSetup({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <path d="M11 14h2M15 14h1M13 11v2M13 15v2" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M4.93 4.93l1.06 1.06M14.01 14.01l1.06 1.06M4.93 15.07l1.06-1.06M14.01 5.99l1.06-1.06" />
    </svg>
  );
}

function IconReimburse({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v1.5M10 12.5V14" />
      <path d="M7.5 12c0 1.1.9 1.5 2.5 1.5s2.5-.4 2.5-1.5-1-1.5-2.5-1.5S7.5 9.1 7.5 8c0-1.1 1-1.5 2.5-1.5S12.5 7 12.5 8" />
    </svg>
  );
}

function IconAdmin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5L4 5v4.5c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V5L10 2.5z" />
      <path d="M7.5 10l1.5 1.5 3-3" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard",      label: "Dashboard",    short: "Week",      Icon: IconWeek },
  { href: "/reimbursements", label: "Reimburse",    short: "Reimburse", Icon: IconReimburse },
  { href: "/history",        label: "History",      short: "History",   Icon: IconHistory },
  { href: "/setup",          label: "Setup",        short: "Setup",     Icon: IconSetup },
  { href: "/settings",       label: "Settings",     short: "Settings",  Icon: IconSettings },
];

const ADMIN_ITEM = { href: "/admin", label: "Admin", short: "Admin", Icon: IconAdmin };

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

  const allNavItems = [...NAV_ITEMS, ...(isSuperAdmin ? [ADMIN_ITEM] : [])];

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
        {allNavItems.map(({ href, short, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-3 py-1 min-w-[3rem] transition-colors ${
                active ? "text-amber-400" : "text-stone-500"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{short}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
