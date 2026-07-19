"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "@/lib/axios";

export interface Household {
  id: string;
  name: string;
  role: string;
  default_currency: string;
}

const ACTIVE_HOUSEHOLD_KEY = "homly_active_household_id";

interface HouseholdContextValue {
  households: Household[];
  activeHouseholdId: string | null;
  activeHousehold: Household | null;
  loading: boolean;
  switchHousehold: (id: string) => void;
  refreshHouseholds: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshHouseholds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Household[]>("/households");
      const list = res.data || [];
      setHouseholds(list);

      const stored = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
      const valid = list.find((h) => h.id === stored);
      const next = valid ? valid.id : list[0]?.id ?? null;
      setActiveHouseholdId(next);
      if (next) localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, next);
    } catch {
      setHouseholds([]);
      setActiveHouseholdId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHouseholds();
  }, [refreshHouseholds]);

  const switchHousehold = useCallback((id: string) => {
    localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, id);
    setActiveHouseholdId(id);
    // Simplest correct behavior: most pages fetch their own data on mount,
    // so a full reload guarantees every page re-fetches under the new household.
    window.location.reload();
  }, []);

  const activeHousehold = households.find((h) => h.id === activeHouseholdId) ?? null;

  return (
    <HouseholdContext.Provider
      value={{ households, activeHouseholdId, activeHousehold, loading, switchHousehold, refreshHouseholds }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within a HouseholdProvider");
  return ctx;
}

export function getActiveHouseholdId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
}
