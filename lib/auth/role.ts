import { User, UtensilsCrossed, ShieldCheck } from "lucide-react";

export type Role = "user" | "staff" | "admin";

export const roles: {
  id: Role;
  label: string;
  description: string;
  icon: typeof User;
}[] = [
  {
    id: "user",
    label: "Customer",
    description: "Book tables and view your reservations",
    icon: User,
  },
  {
    id: "staff",
    label: "Staff",
    description: "Manage orders, tables, and the kitchen",
    icon: UtensilsCrossed,
  },
  {
    id: "admin",
    label: "Admin",
    description: "Full access to reports, menu, and billing",
    icon: ShieldCheck,
  },
];

export function resolveUserRole(role?: Role | string | null): Role {
  const value = role?.toLowerCase?.() ?? "user";
  if (value === "staff") return "staff";
  if (value === "admin") return "admin";
  return "user";
}

export function hasRoleAccess(
  role: Role | string | null,
  allowed: Role[] | Role,
): boolean {
  const resolved = resolveUserRole(role);
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];
  return allowedRoles.includes(resolved);
}

export function getRoleLandingPath(role?: Role | string | null): string {
  return roleRedirect[resolveUserRole(role)];
}

// Roles that may register themselves through the public sign-up flow. Staff
// and admin accounts are provisioned by an administrator and can only be
// signed in to.
export const SELF_SIGNUP_ROLES: Role[] = ["user"];

export function canSelfSignup(role?: Role | string | null): boolean {
  return SELF_SIGNUP_ROLES.includes(resolveUserRole(role));
}

export const roleRedirect: Record<Role, string> = {
  user: "/my-dashboard",
  staff: "/dashboard",
  admin: "/dashboard",
};
