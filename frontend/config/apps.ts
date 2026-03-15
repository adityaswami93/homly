export interface NavItem {
  label: string;
  href: string;
}

export interface App {
  id: string;
  label: string;
  icon: "home" | "credit-card" | "shield" | "settings" | "admin";
  color: string;
  accent: string;
  href: string;
  nav: NavItem[];
  actionLabel?: string;
  superAdminOnly?: boolean;
}

export const apps: App[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    color: "#6B7280",
    accent: "#1F2937",
    href: "/",
    nav: [],
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: "credit-card",
    color: "#10B981",
    accent: "#064E3B",
    href: "/expenses",
    nav: [
      { label: "Overview", href: "/expenses" },
      { label: "History", href: "/expenses/history" },
      { label: "Members", href: "/expenses/members" },
      { label: "Analytics", href: "/expenses/analytics" },
      { label: "Price Intelligence", href: "/expenses/price-intelligence" },
      { label: "Reimburse", href: "/expenses/reimburse" },
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    icon: "shield",
    color: "#10B981",
    accent: "#064E3B",
    href: "/insurance",
    nav: [
      { label: "Policies", href: "/insurance" },
      { label: "Renewals", href: "/insurance/renewals" },
      { label: "Coverage", href: "/insurance/coverage" },
    ],
    actionLabel: "Add Policy",
  },
  {
    id: "admin",
    label: "Admin",
    icon: "admin",
    color: "#10B981",
    accent: "#064E3B",
    href: "/admin",
    nav: [
      { label: "Overview", href: "/admin" },
    ],
    superAdminOnly: true,
  },
];

export function getActiveApp(pathname: string): App | null {
  if (pathname.startsWith("/admin")) return apps.find((a) => a.id === "admin") ?? null;
  if (pathname.startsWith("/insurance")) return apps.find((a) => a.id === "insurance") ?? null;
  if (pathname.startsWith("/expenses")) return apps.find((a) => a.id === "expenses") ?? null;
  if (pathname === "/") return apps.find((a) => a.id === "home") ?? null;
  return null;
}

export function getPageTitle(pathname: string, activeApp: App | null): string {
  if (!activeApp) return "Homly";
  const navItem = activeApp.nav.find((n) => n.href === pathname);
  if (navItem) return navItem.label;
  return activeApp.label;
}
