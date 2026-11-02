"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { resolveUserRole, Role } from "@/lib/auth/role";

export function RoleGuard({
  children,
  allow,
  redirect = "/dashboard",
}: {
  children: React.ReactNode;
  allow: Role[];
  redirect?: string;
}) {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/sign-in");
      return;
    }

    const role = resolveUserRole(
      session.user?.user_metadata?.role ?? session.user?.app_metadata?.role,
    );

    if (!allow.includes(role)) {
      router.replace(redirect);
    }
  }, [allow, loading, redirect, router, session]);

  if (loading || !session) {
    return <div className="bo-loading">Loading…</div>;
  }

  const role = resolveUserRole(
    session.user?.user_metadata?.role ?? session.user?.app_metadata?.role,
  );

  if (!allow.includes(role)) {
    return <div className="bo-loading">Access denied.</div>;
  }

  return <>{children}</>;
}
