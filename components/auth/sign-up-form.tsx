"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Lock, User, ArrowLeft, CheckCircle2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { supabase } from "@/lib/supabase/client";
import {
  Role,
  roles,
  getRoleLandingPath,
  resolveUserRole,
  canSelfSignup,
} from "@/lib/auth/role";

export default function SignUpForm({ role }: { role: Role }) {
  const router = useRouter();
  const roleInfo = roles.find((r) => r.id === role)!;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  // Defensive guard: only customers may self-register. Staff and admin accounts
  // are provisioned by an administrator, so redirect anyone who reaches this
  // form for a non-self-signup role back to that role's sign-in page.
  useEffect(() => {
    if (!canSelfSignup(role)) {
      router.replace(`/sign-in/${role}`);
    }
  }, [role, router]);

  if (!canSelfSignup(role)) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError("Fill in all fields.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim(), role } },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // When email confirmation is enabled, signUp returns no session until the
    // user clicks the confirmation link, so ask them to confirm before signing in.
    if (!data.session) {
      setCreated(true);
      return;
    }

    // Redirect to the dashboard that matches the account's ACTUAL role from
    // the created session (falling back to the role chosen on the form), so a
    // customer lands on their own member dashboard (/my-dashboard) instead of
    // being sent to the staff/admin management workspace (/dashboard).
    const signedUpRole = resolveUserRole(
      data.user?.user_metadata?.role ??
        data.user?.app_metadata?.role ??
        role,
    );
    router.push(getRoleLandingPath(signedUpRole));
  };

  return (
    <AuthShell
      eyebrow={`${roleInfo.label} sign up`}
      title={`Join as ${roleInfo.label.toLowerCase()}.`}
    >
      {created ? (
        <div className="auth-success">
          <div className="auth-success-icon">
            <CheckCircle2 size={28} />
          </div>
          <p>
            Account created! We sent a confirmation link to{" "}
            <strong>{email.trim().toLowerCase()}</strong>. Click the link to
            verify your email, then sign in.
          </p>
          <Link
            href={`/sign-in/${role}`}
            className="cream-button auth-submit"
            style={{ marginTop: 24 }}
          >
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
        <Link href={`/sign-in/${role}`} className="auth-back">
          <ArrowLeft size={13} /> Back to sign in
        </Link>
        {error && <div className="auth-error">{error}</div>}
        <div className="form-field">
          <label>
            <User size={11} /> Full name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Maria Santos"
            autoComplete="name"
          />
        </div>
        <div className="form-field">
          <label>
            <Mail size={11} /> Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@qitchen.ph"
            autoComplete="email"
          />
        </div>
        <div className="form-field">
          <label>
            <Lock size={11} /> Password
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
              <Loader2 size={15} className="animate-spin" /> Creating account…
            </>
          ) : (
            `Create ${roleInfo.label} account`
          )}
        </button>
        <p className="auth-switch">
          Already have an account?{" "}
          <Link href={`/sign-in/${role}`} className="auth-link">
            Sign in
          </Link>
        </p>
        </form>
      )}
    </AuthShell>
  );
}
