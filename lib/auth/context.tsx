"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

import { Session, User, AuthChangeEvent } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import {
  getDemoSession,
  clearDemoSession,
  DEMO_SESSION_EVENT,
} from "@/lib/auth/demo";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * True once the session's role has been merged with the authoritative
   * `profiles.role` (or that lookup failed and the raw session is used
   * as-is). `resolveAndSet` publishes the raw session first so route guards
   * never see a transient null session, but that raw session can carry a
   * stale or missing JWT role (the accounts migration
   * 20261013000000_get_user_role_from_profiles documents) — so role-based
   * redirects must wait for this flag instead of firing against the raw role.
   */
  roleReady: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  roleReady: false,
});

// Enrich a real Supabase session with the authoritative role/full_name stored
// in the profiles table, falling back to whatever is already on the session if
// the lookup fails (so a transient DB error never logs the user out).
async function enrichSession(realSession: Session): Promise<Session> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", realSession.user.id)
      .maybeSingle();

    if (!profile) return realSession;

    return {
      ...realSession,
      user: {
        ...realSession.user,
        user_metadata: {
          ...realSession.user.user_metadata,
          full_name: profile.full_name,
          role: profile.role,
        },
      },
    };
  } catch {
    return realSession;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleReady, setRoleReady] = useState(false);

  // Resolve the effective session. A real Supabase session ALWAYS takes
  // priority over the local demo session; the demo session is only used as a
  // fallback when nobody is signed in for real. This prevents a leftover demo
  // admin session from overriding a genuine staff/customer login.
  const resolveAndSet = useCallback(async (realSession: Session | null) => {
    if (realSession?.user) {
      // Set immediately (with the role already on the session) so route guards
      // never see a transient null session and bounce the user to /sign-in,
      // then enrich with the authoritative role from the profiles table.
      // Until that merge lands — and again on every token refresh, which
      // republishes the raw session — the role on the session may be the raw
      // JWT value, so `roleReady` stays false and role-keyed redirects hold
      // off (they used to bounce staff/admin off /billing mid-settle).
      // `enrichSession` never rejects (it has its own catch-all fallback), so
      // the flag always flips back to true.
      setSession(realSession);
      setRoleReady(false);
      const enriched = await enrichSession(realSession);
      setSession(enriched);
      setRoleReady(true);

      // A real user is signed in — drop any stale demo session so it can never
      // resurface later and hijack the role again.
      if (getDemoSession()) clearDemoSession();
      return;
    }

    // No real session: fall back to the local demo session if one exists. Its
    // role is authoritative as-is (no profiles lookup), so it is ready at once.
    setSession(getDemoSession());
    setRoleReady(true);
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(async ({ data }: { data: { session: Session | null } }) => {
        await resolveAndSet(data.session);
        setLoading(false);
      });

    // Always listen for real auth changes (previously this was skipped when a
    // demo session existed, which is why later logins appeared to be ignored).
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, newSession: Session | null) => {
        resolveAndSet(newSession);
      },
    );

    // React to a client-side demo sign-in/out (no full page reload involved).
    const handleDemoChange = () => {
      supabase.auth.getSession().then(({ data }) => {
        // A real session still wins; only apply the demo session otherwise.
        if (data.session?.user) return;
        setSession(getDemoSession());
      });
    };
    window.addEventListener(DEMO_SESSION_EVENT, handleDemoChange);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener(DEMO_SESSION_EVENT, handleDemoChange);
    };
  }, [resolveAndSet]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        roleReady,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
