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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
      setIsSuperAdmin(session.user.user_metadata?.is_super_admin === true);
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const activeApp = getActiveApp(pathname);
  const pageTitle = getPageTitle(pathname, activeApp);

  if (!user) return null;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#0f0e0c]">
      {/* Rail */}
      <Rail activeApp={activeApp} isSuperAdmin={isSuperAdmin} />

      {/* Subnav */}
      <Subnav activeApp={activeApp} pathname={pathname} connected={connected} />

      {/* Main content column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <Topbar
          pageTitle={pageTitle}
          activeApp={activeApp}
          user={user}
          onSignOut={handleSignOut}
        />

        {/* Mobile horizontal subnav pills */}
        {activeApp && activeApp.nav.length > 1 && (
          <div className="lg:hidden border-b border-stone-800 bg-[#111827] shrink-0">
            <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-none">
              {activeApp.nav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[36px] flex items-center ${
                      isActive ? "text-white" : "text-stone-400 hover:text-stone-200 bg-stone-800"
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
      <BottomTabBar activeApp={activeApp} isSuperAdmin={isSuperAdmin} />
    </div>
  );
}
