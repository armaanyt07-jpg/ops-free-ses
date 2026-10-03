"use client";

import { useEffect, useRef, useState } from "react";

import { TURNSTILE_ORIGIN, turnstileSiteKey } from "@/lib/auth/captcha";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Below this form width, the standard widget no longer fits. */
const TURNSTILE_MIN_STANDARD_WIDTH = 300;

let loading: Promise<void> | null = null;

/** Loads Cloudflare's script once per page, however many forms ask for it. */
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null; // allow a retry on the next mount
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The Cloudflare Turnstile widget. Renders nothing without a site key.
 *
 * A token is single-use, so `resetSignal` (the form's last result) fetches a
 * fresh one after every submission, successful or not; otherwise a mistyped
 * password would leave the user holding a spent token.
 */
export function TurnstileField({
  onToken,
  resetSignal,
}: {
  /** Called with the token when the check passes, and with "" when it's gone. */
  onToken: (token: string) => void;
  resetSignal: unknown;
}) {
  const siteKey = turnstileSiteKey();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const firstRun = useRef(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          // Match the page, so a dark sign-in form doesn't carry a white box.
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          // The standard widget needs about 300px. On narrower forms (small
          // phones) it would be clipped, so use Cloudflare's compact size.
          size: container.current.clientWidth < TURNSTILE_MIN_STANDARD_WIDTH ? "compact" : "flexible",
          callback: (token: string) => {
            setFailed(false);
            onToken(token);
          },
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            setFailed(true);
          },
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onToken("");
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetSignal, onToken]);

  if (!siteKey) return null;

  return (
    <div className="space-y-2">
      <div ref={container} />
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          The human check couldn’t load. Turn off any content blocker for this site, or reload and try again.
        </p>
      ) : null}
    </div>
  );
}
