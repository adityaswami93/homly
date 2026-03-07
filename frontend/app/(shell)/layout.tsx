"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import api from "@/lib/axios";
import Rail from "@/app/components/shell/Rail";
import Subnav from "@/app/components/shell/Subnav";
import Topbar from "@/app/components/shell/Topbar";
import BottomTabBar from "@/app/components/shell/BottomTabBar";
import { getActiveApp, getPageTitle } from "@/config/apps";
import Link from "next/link";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    api
      .get("/setup/state")
      .then((res) => {
        if (res?.data?.connected !== undefined) {
          setConnected(res.data.connected);
        }
      })
      .catch(() => null);
  }, []);

  const activeApp = getActiveApp(pathname);
  const pageTitle = getPageTitle(pathname, activeApp);

  if (!user) return null;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#F8F9FB]">
      {/* Rail — visible on tablet (md) and up */}
      <Rail activeApp={activeApp} user={user} />

      {/* Subnav — visible on desktop (lg) only */}
      <Subnav activeApp={activeApp} pathname={pathname} connected={connected} />

      {/* Main content column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <Topbar
          pageTitle={pageTitle}
          activeApp={activeApp}
          actionLabel={activeApp?.actionLabel}
          onAction={activeApp?.actionLabel ? () => setShowAddModal(true) : undefined}
        />

        {/* Mobile horizontal subnav pills — below topbar, above content, hidden on desktop */}
        {activeApp && activeApp.nav.length > 1 && (
          <div className="lg:hidden border-b border-gray-100 bg-white shrink-0">
            <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-none">
              {activeApp.nav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[36px] flex items-center ${
                      isActive ? "text-white" : "text-gray-500 hover:text-gray-700 bg-gray-100"
                    }`}
                    style={isActive ? { backgroundColor: activeApp.color } : {}}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable page content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}
        >
          <div className="lg:pb-0">{children}</div>
        </main>
      </div>

      {/* Bottom tab bar — mobile only */}
      <BottomTabBar activeApp={activeApp} />

      {/* Global "add" modal trigger — pages listen for this via context or URL param */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 mb-2">
              {activeApp?.actionLabel}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Use the form on this page to add a new item.
            </p>
            <button
              onClick={() => setShowAddModal(false)}
              className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
