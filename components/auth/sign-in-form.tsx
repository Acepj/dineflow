"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Lock, ArrowLeft } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { supabase } from "@/lib/supabase/client";
import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  buildDemoSession,
  setDemoSession,
} from "@/lib/auth/demo";
import {
  resolveUserRole,
  Role,
  roles,
  getRoleLandingPath,
} from "@/lib/auth/role";

export default function SignInForm({ role }: { role: Role }) {
  const router = useRouter();
  const roleInfo = roles.find((r) => r.id === role)!;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setNeedsConfirmation(false);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);

    if (
      role === "admin" &&
      email.trim().toLowerCase() === DEMO_ADMIN_EMAIL &&
      password === DEMO_ADMIN_PASSWORD
    ) {
      // Clear any real Supabase session first so the demo session becomes the
      // authoritative session (the auth context always prefers a real session).
      await supabase.auth.signOut();
      const demoSession = buildDemoSession();
      setDemoSession(demoSession);
      setLoading(false);
      router.push(getRoleLandingPath("admin"));
      return;
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword(
      {
        email: email.trim(),
        password,
      },
    );
    setLoading(false);
    if (signInError) {
      if (/not confirmed/i.test(signInError.message || "")) {
        setNeedsConfirmation(true);
        setError(
          `This email hasn't been confirmed yet. Check ${email
            .trim()
            .toLowerCase()} for the confirmation link we sent, then try again.`,
        );
      } else {
        setError(
          signInError.message === "Invalid login credentials"
            ? "Incorrect email or password."
            : signInError.message,
        );
      }
      return;
    }

    const { data: profile } = data.user
      ? await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle()
      : { data: null };
    const signedInRole = resolveUserRole(
      profile?.role ??
        data.user?.user_metadata?.role ??
        data.user?.app_metadata?.role,
    );

    if (signedInRole !== role) {
      await supabase.auth.signOut();
      setError(
        `This account is registered as ${roles.find((item) => item.id === signedInRole)?.label || "Customer"}. Choose that role to continue.`,
      );
      return;
    }

    router.push(getRoleLandingPath(signedInRole));
  };

  const handleResendConfirmation = async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    setResending(false);
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setNotice(`Confirmation link sent to ${email.trim().toLowerCase()}.`);
  };

  return (
    <AuthShell eyebrow={`${roleInfo.label} sign in`} title="Welcome back.">
      <form onSubmit={handleSubmit} className="auth-form">
        <Link href="/sign-in" className="auth-back">
          <ArrowLeft size={13} /> Choose a different role
        </Link>
        {error && <div className="auth-error">{error}</div>}
        {notice && <div className="auth-sub">{notice}</div>}
        {needsConfirmation && (
          <div className="auth-error" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="auth-link"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
              }}
              disabled={resending}
              onClick={handleResendConfirmation}
            >
              {resending ? "Sending…" : "Resend confirmation email"}
            </button>
          </div>
        )}
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
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        <div className="auth-form-extra">
          <Link href="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          className="cream-button auth-submit"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Signing in…
            </>
          ) : (
            `Sign in as ${roleInfo.label}`
          )}
        </button>
        {role === "user" ? (
          <p className="auth-switch">
            No account?{" "}
            <Link href="/sign-up/user" className="auth-link">
              Create one
            </Link>
          </p>
        ) : (
          <p className="auth-sub">
            
          </p>
        )}
      </form>
    </AuthShell>
  );
}
