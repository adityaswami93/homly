/**
 * config/apps.ts is the single source of truth for shell navigation, so a
 * mismatch between it and the routes on disk shows up as a nav item that leads
 * to a 404, or a page whose rail highlights the wrong app. CLAUDE.md flags
 * exactly this drift as a recurring problem in this repo.
 *
 * The last two tests are the valuable ones: rather than asserting a fixed list
 * of routes that would itself need maintaining, they check the config against
 * the filesystem, so adding a page without a nav entry — or a nav entry without
 * a page — fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { apps, getActiveApp, getPageTitle } from "./apps";

// Relative to this file rather than to cwd, so the filesystem checks below
// hold however the suite is invoked. Test files run as ESM under vitest, so
// import.meta.url is the reliable anchor here (__dirname is not).
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

/** Does a route resolve to a page.tsx, allowing for route groups like (shell)? */
function routeExists(href: string): boolean {
  const segments = href.split("/").filter(Boolean);
  const candidates = [APP_DIR];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of candidates) {
      const direct = path.join(dir, segment);
      if (fs.existsSync(direct)) next.push(direct);
      // A route group — app/(shell)/expenses — adds no URL segment.
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith("(") && entry.name.endsWith(")")) {
          const grouped = path.join(dir, entry.name, segment);
          if (fs.existsSync(grouped)) next.push(grouped);
        }
      }
    }
    if (next.length === 0) return false;
    candidates.length = 0;
    candidates.push(...next);
  }
  return candidates.some(
    (dir) =>
      fs.existsSync(path.join(dir, "page.tsx")) ||
      fs
        .readdirSync(dir, { withFileTypes: true })
        .some(
          (e) =>
            e.isDirectory() &&
            e.name.startsWith("(") &&
            fs.existsSync(path.join(dir, e.name, "page.tsx")),
        ),
  );
}

describe("getActiveApp", () => {
  it("resolves each app from its own route prefix", () => {
    expect(getActiveApp("/expenses")?.id).toBe("expenses");
    expect(getActiveApp("/insurance/renewals")?.id).toBe("insurance");
    expect(getActiveApp("/savings")?.id).toBe("savings");
    expect(getActiveApp("/chores/setup")?.id).toBe("chores");
    expect(getActiveApp("/admin")?.id).toBe("admin");
  });

  it("resolves the root path to the home app", () => {
    expect(getActiveApp("/")?.id).toBe("home");
  });

  it("returns null for a path outside every app", () => {
    expect(getActiveApp("/login")).toBeNull();
    expect(getActiveApp("/onboarding")).toBeNull();
  });

  it("matches on prefix, so nested routes keep their app active", () => {
    expect(getActiveApp("/expenses/transactions")?.id).toBe("expenses");
    expect(getActiveApp("/expenses/summary")?.id).toBe("expenses");
  });

  it("claims /admin1 for the admin app, because the check is a prefix match", () => {
    // Documenting a real edge, not endorsing it: app/admin1/page.tsx is a
    // separate route that startsWith("/admin") captures, so the rail shows the
    // admin app there. If /admin1 is ever meant to be its own thing, this is
    // the line that has to change.
    expect(getActiveApp("/admin1")?.id).toBe("admin");
  });
});

describe("getPageTitle", () => {
  it("uses the nav item's label when the path is an exact nav href", () => {
    const expenses = apps.find((a) => a.id === "expenses")!;
    const first = expenses.nav[0];
    expect(getPageTitle(first.href, expenses)).toBe(first.label);
  });

  it("falls back to the app label for a path with no nav entry", () => {
    const expenses = apps.find((a) => a.id === "expenses")!;
    expect(getPageTitle("/expenses/some/deep/route", expenses)).toBe(expenses.label);
  });

  it("falls back to Homly when no app is active", () => {
    expect(getPageTitle("/login", null)).toBe("Homly");
  });
});

describe("config integrity", () => {
  it("has unique app ids", () => {
    const ids = apps.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every nav href back to its own app", () => {
    // Catches a nav item filed under the wrong app, which would make the rail
    // highlight jump when you click it.
    for (const app of apps) {
      if (app.id === "home") continue; // no nav, and "/" is special-cased last
      for (const item of app.nav) {
        expect(getActiveApp(item.href)?.id, `${app.id} → ${item.href}`).toBe(app.id);
      }
    }
  });

  it("points every nav href at a page that exists on disk", () => {
    const missing: string[] = [];
    for (const app of apps) {
      for (const item of app.nav) {
        if (!routeExists(item.href)) missing.push(`${app.id}: ${item.href}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("points every app href at a page that exists on disk", () => {
    const missing = apps.filter((a) => !routeExists(a.href)).map((a) => `${a.id}: ${a.href}`);
    expect(missing).toEqual([]);
  });
});
