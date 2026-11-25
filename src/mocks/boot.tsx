"use client";

import { type ReactNode, useEffect, useState } from "react";

const STORAGE_KEY = "tsumiki:msw";

/**
 * Boots the MSW service worker for the whole Next.js app and renders
 * children only once mocking is active, so no request can leak past the
 * worker before handlers are registered.
 *
 * Enable with `?msw=1` (persists across navigation via localStorage) or the
 * NEXT_PUBLIC_MSW=1 environment variable. Disable again with `?msw-off=1`.
 */
export function MockGate({ children }: { children: ReactNode }) {
  const [blocking, setBlocking] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    if (params.has("msw-off")) {
      window.localStorage.removeItem(STORAGE_KEY);
      setBlocking(false);
      return;
    }
    if (params.has("msw")) window.localStorage.setItem(STORAGE_KEY, "1");
    const requested =
      params.has("msw") ||
      window.localStorage.getItem(STORAGE_KEY) === "1" ||
      process.env.NEXT_PUBLIC_MSW === "1";
    if (!requested) {
      setBlocking(false);
      return;
    }
    // Lazy-load so the SSR graph never evaluates the browser-only worker.
    void (async () => {
      const { startMocking } = await import("./worker");
      await startMocking();
      if (!cancelled) setBlocking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (blocking === null) return null;
  return <>{children}</>;
}
