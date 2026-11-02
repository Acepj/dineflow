"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { resolveUserRole } from "@/lib/auth/role";

export function DashboardBackButton() {
  const { session } = useAuth();
  const role = resolveUserRole(
    session?.user?.user_metadata?.role ?? session?.user?.app_metadata?.role,
  );
  const href = role === "user" ? "/my-dashboard" : "/dashboard";

  return (
    <Link className="dashboard-back" href={href}>
      <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
      <span>Back to dashboard</span>
    </Link>
  );
}
