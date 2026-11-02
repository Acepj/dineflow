"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Grid3x3,
  CalendarDays,
  ShoppingCart,
  BarChart3,
  Menu as MenuIcon,
  X,
  LogOut,
  User,
  FileText,
  Settings,
  Users as UsersIcon,
  CreditCard,
  History,
  Search,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { clearDemoSession } from "@/lib/auth/demo";
import { supabase } from "@/lib/supabase/client";
import { resolveUserRole, Role } from "@/lib/auth/role";
import { Toaster } from "@/components/ui/sonner";
import { TopbarNotifications } from "@/components/shell/topbar-notifications";

const navByRole: Record<
  Role,
  { href: string; label: string; icon: typeof LayoutDashboard }[]
> = {
  user: [
    { href: "/my-dashboard", label: "My Account", icon: LayoutDashboard },
    { href: "/menu", label: "Menu", icon: MenuIcon },
    { href: "/cart", label: "Cart", icon: ShoppingCart },
    { href: "/my-orders", label: "My Orders", icon: FileText },
    {
      href: "/my-orders?tab=reservations",
      label: "My Reservations",
      icon: CalendarDays,
    },
    { href: "/profile", label: "Profile", icon: User },
  ],
  staff: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/orders", label: "Orders", icon: ShoppingCart },
    { href: "/tables", label: "Tables", icon: Grid3x3 },
    { href: "/reservations", label: "Reservations", icon: CalendarDays },
    { href: "/order-history", label: "Order History", icon: FileText },
    {
      href: "/reservation-history",
      label: "Reservation History",
      icon: History,
    },
    {
      href: "/menu-management/items",
      label: "Menu Availability",
      icon: UtensilsCrossed,
    },
    { href: "/profile", label: "Profile", icon: User },
  ],
  admin: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/orders", label: "Orders", icon: ShoppingCart },
    { href: "/reservations", label: "Reservations", icon: CalendarDays },
    { href: "/tables", label: "Tables", icon: Grid3x3 },
    { href: "/menu-management/items", label: "Menu", icon: UtensilsCrossed },
    { href: "/customers", label: "Customers", icon: UsersIcon },
    { href: "/users", label: "Staff / Admin", icon: User },
    { href: "/payments", label: "Payments", icon: CreditCard },
    { href: "/order-history", label: "Order History", icon: FileText },
    {
      href: "/reservation-history",
      label: "Reservation History",
      icon: History,
    },
    { href: "/sales", label: "Sales & Reports", icon: BarChart3 },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/profile", label: "Profile", icon: User },
  ],
};

// Routes a role may open even though they are not shown in the sidebar. Staff
// AND admin settle and view receipts at /billing/[orderId] (linked from the
// Orders list), but "Billing" was deliberately removed from the staff nav and
// never added to the admin nav — so the path must be allowed here for both
// roles or the guard below would bounce them back to the dashboard mid-settle.
const extraAllowedByRole: Record<Role, string[]> = {
  user: [],
  staff: ["/billing"],
  admin: ["/billing"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading, roleReady } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const role = resolveUserRole(
    session?.user?.user_metadata?.role ?? session?.user?.app_metadata?.role,
  );
  const navItems = navByRole[role];

  useEffect(() => {
    // Role-keyed redirects wait for `roleReady`: the auth context publishes the
    // raw session first (so guards never see a transient null session) and only
    // then merges the authoritative role from `profiles` — and every token
    // refresh reopens that window. Redirecting against the raw session role is
    // what used to bounce staff/admin off /billing/[orderId] (the Settle screen
    // reached from Orders) straight back to /dashboard. Only the signed-out
    // redirect runs regardless, so logging out still takes effect immediately.
    if (!loading && session && roleReady && role === "user") {
      router.replace("/my-dashboard");
      return;
    }

    if (!loading && !session) {
      router.replace("/sign-in");
      return;
    }

    if (!loading && session && roleReady) {
      const pathAllowed = [
        ...navItems.map((item) => item.href),
        ...extraAllowedByRole[role],
      ].some(
        (href) =>
          pathname === href ||
          (href !== "/dashboard" && pathname.startsWith(href)),
      );

      if (!pathAllowed && pathname !== "/") {
        router.replace(role === "user" ? "/my-dashboard" : "/dashboard");
      }
    }
  }, [loading, navItems, pathname, role, roleReady, router, session]);

  const handleSignOut = async () => {
    clearDemoSession();
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  // Close the profile menu on outside click / Escape.
  useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".bo-profile-wrap")) setProfileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  // Top-bar quick search jumps to the reservations workspace, where the term
  // is applied to code / customer / phone search.
  const handleQuickSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = searchTerm.trim();
    setSearchOpen(false);
    router.push(
      term ? `/reservations?search=${encodeURIComponent(term)}` : "/reservations",
    );
  };

  if (loading) return <div className="bo-loading">Loading…</div>;
  if (!session) return null;
  if (role === "user") return <div className="bo-loading">Loading…</div>;

  const userName =
    session.user.user_metadata?.full_name || session.user.email || "User";

  return (
    <div className="bo-shell">
      <aside className={`bo-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="bo-logo">
          <Link href="/dashboard">QITCHEN</Link>
          <button
            className="bo-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="bo-nav">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`bo-nav-item ${active ? "active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="bo-sidebar-footer">
          <div className="bo-user">
            <div className="bo-user-avatar">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="bo-user-details">
              <span className="bo-user-name">{userName}</span>
              <span className="bo-user-role">
                {role === "admin"
                  ? "Administrator"
                  : role === "staff"
                    ? "Service staff"
                    : "Customer"}
              </span>
            </div>
          </div>
          <button
            className="bo-signout"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut size={15} /> <span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="bo-main">
        <header className="bo-topbar">
          <button
            className="bo-menu-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon size={20} />
          </button>
          <div className="bo-topbar-heading">
            <div className="bo-topbar-title">
              {navItems.find(
                (item) =>
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href)),
              )?.label || "Dashboard"}
            </div>
            <span className="bo-topbar-subtitle">
              Kitchen Management Workspace
            </span>
          </div>
          <div className="bo-topbar-actions">
            {searchOpen ? (
              <form
                className="bo-topbar-search-form"
                role="search"
                onSubmit={handleQuickSearch}
              >
                <input
                  className="bo-topbar-search"
                  autoFocus
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Search reservations…"
                  aria-label="Search reservations by code, customer or phone"
                />
              </form>
            ) : null}
            <button
              className="bo-topbar-icon"
              onClick={() => setSearchOpen((open) => !open)}
              aria-label={
                searchOpen ? "Close search" : "Search reservations"
              }
              aria-expanded={searchOpen}
              title="Search reservations"
            >
              <Search size={17} />
            </button>
            <TopbarNotifications />
            <div className="bo-profile-wrap">
              <button
                className="bo-profile-button"
                onClick={() => setProfileOpen((open) => !open)}
                aria-expanded={profileOpen}
              >
                <span className="bo-user-avatar">
                  {userName.charAt(0).toUpperCase()}
                </span>
                <span className="bo-profile-name">{userName}</span>
                <ChevronDown size={14} />
              </button>
              {profileOpen && (
                <div className="bo-profile-menu" role="menu">
                  <span>
                    {role === "admin"
                      ? "Administrator"
                      : role === "staff"
                        ? "Service staff"
                        : "Customer"}
                  </span>
                  <Link
                    href="/profile"
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link
                    href={role === "admin" ? "/settings" : "/profile"}
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                  >
                    Account settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSignOut}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="bo-content">{children}</div>
      </div>
      <Toaster theme="dark" position="top-right" closeButton />
    </div>
  );
}
