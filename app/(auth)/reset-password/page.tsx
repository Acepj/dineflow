"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, CheckCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { supabase } from "@/lib/supabase/client";
import { resolveUserRole, getRoleLandingPath } from "@/lib/auth/role";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [landing, setLanding] = useState(getRoleLandingPath("user"));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/sign-in");
      else setReady(true);
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const updatedRole = resolveUserRole(
      sessionData.session?.user?.user_metadata?.role ??
        sessionData.session?.user?.app_metadata?.role,
    );
    setLanding(getRoleLandingPath(updatedRole));
    setTimeout(() => router.push(getRoleLandingPath(updatedRole)), 2000);
  };

  if (!ready)
    return (
      <AuthShell eyebrow="Loading" title="…">
        <div className="auth-sub">Verifying your session…</div>
      </AuthShell>
    );

  return (
    <AuthShell eyebrow="Set new password" title="Choose a new password.">
      {done ? (
        <div className="auth-success">
          <div className="auth-success-icon">
            <CheckCircle size={28} />
          </div>
          <p>Password updated. Redirecting you to the dashboard…</p>
          <Link
            href={landing}
            className="cream-button auth-submit"
            style={{ marginTop: 24 }}
          >
            Go to dashboard
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          <div className="form-field">
            <label>
              <Lock size={11} /> New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="form-field">
            <label>
              <Lock size={11} /> Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            className="cream-button auth-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Updating…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
