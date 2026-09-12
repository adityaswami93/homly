/**
 * API_URL is one line of code with a production incident behind it.
 *
 * NEXT_PUBLIC_API_URL is configured with a trailing slash in at least one
 * deploy, and every caller concatenates a leading "/" onto it. That produced
 * `GET //household`, which FastAPI 404s; the 404 body has no `id`, so the
 * household check on the auth pages read it as "no household yet" and bounced
 * returning members to /onboarding (Railway logs, 2026-09-12 05:54 and 05:59).
 *
 * The module reads process.env at import time, so each case has to set the
 * variable and then re-import with a reset module registry — a plain top-level
 * import would freeze whatever the first test happened to set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadApiUrl(value: string | undefined): Promise<string> {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = value;
  }
  return (await import("./apiUrl")).API_URL;
}

const original = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = original;
});

describe("API_URL", () => {
  it("strips a single trailing slash", async () => {
    expect(await loadApiUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("strips several trailing slashes", async () => {
    expect(await loadApiUrl("https://api.example.com///")).toBe("https://api.example.com");
  });

  it("leaves a URL without a trailing slash alone", async () => {
    expect(await loadApiUrl("https://api.example.com")).toBe("https://api.example.com");
  });

  it("keeps a path prefix, stripping only the trailing slash", async () => {
    expect(await loadApiUrl("https://example.com/api/")).toBe("https://example.com/api");
  });

  it("is an empty string when unset, never the string 'undefined'", async () => {
    // `${undefined}/household` would request "/undefined/household" — a 404
    // that looks like a routing bug rather than missing configuration.
    expect(await loadApiUrl(undefined)).toBe("");
  });

  it("never yields a value that produces a doubled slash when a path is appended", async () => {
    for (const configured of [
      "https://api.example.com",
      "https://api.example.com/",
      "https://api.example.com//",
    ]) {
      expect(`${await loadApiUrl(configured)}/household`).toBe("https://api.example.com/household");
    }
  });
});
