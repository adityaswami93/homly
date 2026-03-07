export interface NavItem {
  label: string;
  href: string;
}

export interface App {
  id: string;
  label: string;
  icon: "home" | "credit-card" | "shield" | "settings";
  color: string;
  accent: string;
  href: string;
  nav: NavItem[];
  actionLabel?: string;
}

export const apps: App[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    color: "#6B7280",
    accent: "#F3F4F6",
    href: "/",
    nav: [],
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: "credit-card",
    color: "#10B981",
    accent: "#D1FAE5",
    href: "/expenses",
    nav: [
      { label: "Overview", href: "/expenses" },
      { label: "Transactions", href: "/expenses/transactions" },
      { label: "Members", href: "/expenses/members" },
      { label: "Summary", href: "/expenses/summary" },
    ],
    actionLabel: "Add Expense",
  },
  {
    id: "insurance",
    label: "Insurance",
    icon: "shield",
    color: "#3B82F6",
    accent: "#DBEAFE",
    href: "/insurance",
    nav: [
      { label: "Policies", href: "/insurance" },
      { label: "Renewals", href: "/insurance/renewals" },
    ],
    actionLabel: "Add Policy",
  },
];

export function getActiveApp(pathname: string): App | null {
  if (pathname.startsWith("/insurance")) return apps.find((a) => a.id === "insurance") ?? null;
  if (pathname.startsWith("/expenses")) return apps.find((a) => a.id === "expenses") ?? null;
  if (pathname === "/") return apps.find((a) => a.id === "home") ?? null;
  return null;
}

export function getPageTitle(pathname: string, activeApp: App | null): string {
  if (!activeApp) return "Homly";
  const navItem = activeApp.nav.find((n) => n.href === pathname);
  if (navItem) return navItem.label;
  // Fallback to app label
  return activeApp.label;
}
