"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail, CheckCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { supabase } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${window.location.origin}/reset-password`,
      },
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell eyebrow="Account recovery" title="Reset password.">
      {sent ? (
        <div className="auth-success">
          <div className="auth-success-icon">
            <CheckCircle size={28} />
          </div>
          <p>
            Check your inbox — we sent a password reset link to{" "}
            <strong>{email}</strong>. The link expires in one hour.
          </p>
          <Link
            href="/sign-in"
            className="cream-button auth-submit"
            style={{ marginTop: 24 }}
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
          <p className="auth-sub">
            Enter your account email and we&apos;ll send you a link to set a new
            password.
          </p>
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
          <button
            type="submit"
            className="cream-button auth-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Sending link…
              </>
            ) : (
              "Send reset link"
            )}
          </button>
          <p className="auth-switch">
            Remembered it?{" "}
            <Link href="/sign-in" className="auth-link">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
