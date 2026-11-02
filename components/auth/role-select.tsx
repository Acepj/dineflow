"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { roles, canSelfSignup } from "@/lib/auth/role";

export function RoleSelect({ mode }: { mode: "sign-in" | "sign-up" }) {
  const title =
    mode === "sign-in"
      ? "Who are you signing in as?"
      : "Who are you creating an account for?";
  const eyebrow = mode === "sign-in" ? "Sign in" : "Sign up";
  // Customers may self-register. Staff and admin accounts are provisioned by
  // an administrator, so only the Customer option is offered when signing up.
  const selectableRoles =
    mode === "sign-up" ? roles.filter((r) => canSelfSignup(r.id)) : roles;

  return (
    <AuthShell eyebrow={eyebrow} title={title}>
      <div className="role-select">
        {selectableRoles.map((r) => (
          <Link key={r.id} href={`/${mode}/${r.id}`} className="role-card">
            <div className="role-card-icon">
              <r.icon size={22} />
            </div>
            <div className="role-card-body">
              <span className="role-card-label">{r.label}</span>
              <span className="role-card-desc">{r.description}</span>
            </div>
            <ArrowUpRight size={18} className="role-card-arrow" />
          </Link>
        ))}
      </div>
      {mode === "sign-up" && (
        <p className="auth-sub">
         
        </p>
      )}
      <p className="auth-switch">
        {mode === "sign-in" ? (
          <>
            No account?{" "}
            <Link href="/sign-up" className="auth-link">
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="auth-link">
              Sign in
            </Link>
          </>
        )}
      </p>
    </AuthShell>
  );
}
