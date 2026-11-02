import type { Session } from "@supabase/supabase-js";

export const DEMO_ADMIN_EMAIL = "admin@qitchen.ph";
export const DEMO_ADMIN_PASSWORD = "admin123";
export const DEMO_SESSION_KEY = "dineflow_demo_session";
// Broadcast whenever the demo session changes so the AuthProvider can react to
// a client-side demo sign-in without requiring a full page reload.
export const DEMO_SESSION_EVENT = "dineflow:demo-session-change";

export function buildDemoSession(): Session {
  const now = Date.now();

  return {
    access_token: "demo-admin-access-token",
    refresh_token: "demo-admin-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor((now + 60 * 60 * 1000) / 1000),
    token_type: "bearer",
    user: {
      id: "demo-admin-user",
      aud: "authenticated",
      role: "authenticated",
      email: DEMO_ADMIN_EMAIL,
      email_confirmed_at: new Date().toISOString(),
      phone: "",
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {
        provider: "demo",
        providers: ["demo"],
      },
      user_metadata: {
        full_name: "Admin User",
        role: "admin",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  } as Session;
}

export function getDemoSession(): Session | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Session;
    if (!parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setDemoSession(session: Session) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
}

export function clearDemoSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEMO_SESSION_KEY);
  window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
}
