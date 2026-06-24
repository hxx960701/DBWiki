import { useEffect, useRef } from 'react';
import { authApi } from '../api/auth';

/**
 * Drives the admin "online now" badge.
 *
 * Why a hook and not a setInterval per-request:
 *   The server used to refresh users.last_seen_at on EVERY authenticated
 *   request, which made "online" mean "the browser tab is still open", not
 *   "the user is here". A user who logged in once in the morning and walked
 *   away still showed up online all day. We moved liveness to a client-driven
 *   heartbeat instead.
 *
 * Rules:
 *   - Listen passively for real user activity (mouse / keyboard / scroll /
 *     touch) and stamp lastActivityRef on each event. We never call the API
 *     from the event handler — that would flood it.
 *   - Every HEARTBEAT_INTERVAL_MS we wake up and decide whether to ping:
 *       * tab must be visible (document.visibilityState === 'visible')
 *       * we must have seen activity within the last IDLE_WINDOW_MS
 *     With these thresholds, the server flips a user to "离线" within
 *     ~IDLE_WINDOW_MS + server threshold (2 min) after they stop touching
 *     the page.
 *   - When the tab becomes visible again, ping once immediately so the badge
 *     bounces back without waiting for the next tick.
 *
 * Failures are silent — observability must never break the app.
 */

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const IDLE_WINDOW_MS = 90 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export function useHeartbeat(enabled: boolean): void {
  const lastActivityRef = useRef<number>(Date.now());
  const lastPingRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    // Touch on real user input. We bind passively so scroll perf is unaffected.
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const ping = () => {
      const now = Date.now();
      // Throttle defensively — server throttles too, but this avoids the
      // round-trip entirely when not needed.
      if (now - lastPingRef.current < HEARTBEAT_INTERVAL_MS - 1000) return;
      if (document.visibilityState !== 'visible') return;
      if (now - lastActivityRef.current > IDLE_WINDOW_MS) return;
      lastPingRef.current = now;
      void authApi.heartbeat().catch(() => {
        /* swallow */
      });
    };

    // Immediate kick so freshly-mounted sessions flip to online right away.
    ping();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Returning to the tab counts as activity, and we want the badge to
        // bounce back without waiting up to 30s for the next tick.
        lastActivityRef.current = Date.now();
        ping();
      }
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    const id = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(id);
    };
  }, [enabled]);
}
