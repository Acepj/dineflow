"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import type { Role } from "@/lib/auth/role";
import { supabase } from "@/lib/supabase/client";

type AccountStatus = "active" | "inactive";
type AccountUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  createdAt: string;
};

const pageSize = 10;

function roleLabel(role: Role) {
  return role === "admin" ? "Admin" : role === "staff" ? "Staff" : "Customer";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function UsersPage() {
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">(
    "all",
  );
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AccountUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status, created_at")
      .in("role", ["staff", "admin"])
      .order("full_name");

    if (queryError) {
      setUsers([]);
      setError(true);
      setLoading(false);
      return;
    }

    const accounts = (
      (data || []) as {
        id: string;
        full_name: string;
        email: string | null;
        role: Role;
        status: AccountStatus;
        created_at: string;
      }[]
    ).map(
      (profile) =>
        ({
          id: profile.id,
          name: profile.full_name,
          email: profile.email || "",
          role: profile.role,
          status: profile.status,
          createdAt: profile.created_at,
        }) satisfies AccountUser,
    );
    setUsers(accounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !normalizedSearch ||
        `${user.name} ${user.email}`.toLowerCase().includes(normalizedSearch);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" || user.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const visibleUsers = filteredUsers.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const adminCount = users.filter((user) => user.role === "admin").length;
  const staffCount = users.filter((user) => user.role === "staff").length;
  const activeCount = users.filter((user) => user.status === "active").length;
  const hasFilters = Boolean(
    search || roleFilter !== "all" || statusFilter !== "all",
  );

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setPage(1);
  };

  return (
    <RoleGuard allow={["admin"]} redirect="/dashboard">
      <div className="users-page">
        <DashboardBackButton />
        <header className="users-page-header">
          <div>
            <p className="users-kicker">Staff / Admin</p>
            <h1>Account access</h1>
            <p>
              Manage staff accounts, roles, and access to the DineFlow system.
            </p>
          </div>
        </header>

        {error ? (
          <section className="users-error-state" role="alert">
            <Users size={24} />
            <h2>Unable to load users</h2>
            <p>Please try again.</p>
            <button className="btn-ghost" type="button" onClick={load}>
              <RefreshCw size={14} /> Retry
            </button>
          </section>
        ) : (
          <>
            <section className="users-summary" aria-label="User summary">
              {loading ? (
                ["Total Users", "Admins", "Staff", "Active"].map((label) => (
                  <div
                    className="users-summary-card users-skeleton"
                    key={label}
                  >
                    <span>{label}</span>
                    <i />
                    <em />
                  </div>
                ))
              ) : (
                <>
                  <div className="users-summary-card">
                    <span>Total Users</span>
                    <strong>{users.length}</strong>
                    <small>Registered profiles</small>
                  </div>
                  <div className="users-summary-card">
                    <span>Admins</span>
                    <strong>{adminCount}</strong>
                    <small>Known full-access accounts</small>
                  </div>
                  <div className="users-summary-card">
                    <span>Staff</span>
                    <strong>{staffCount}</strong>
                    <small>Known staff accounts</small>
                  </div>
                  <div className="users-summary-card">
                    <span>Active</span>
                    <strong>{activeCount}</strong>
                    <small>Current session status</small>
                  </div>
                </>
              )}
            </section>

            <section className="users-toolbar" aria-label="User filters">
              <label className="users-search">
                <Search size={15} />
                <input
                  placeholder="Search users..."
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  aria-label="Search users"
                />
              </label>
              <label>
                Role
                <select
                  value={roleFilter}
                  onChange={(event) => {
                    setRoleFilter(event.target.value as Role | "all");
                    setPage(1);
                  }}
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(
                      event.target.value as AccountStatus | "all",
                    );
                    setPage(1);
                  }}
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </section>

            <section className="users-table-card">
              <div className="users-table-heading">
                <div>
                  <p className="users-section-kicker">Users</p>
                  <h2>Account directory</h2>
                  <p>
                    Profile records available to the current admin workspace.
                  </p>
                </div>
                <ShieldCheck size={20} />
              </div>
              {loading ? (
                <div className="users-loading-rows">
                  {[1, 2, 3, 4].map((row) => (
                    <i key={row} />
                  ))}
                </div>
              ) : visibleUsers.length ? (
                <>
                  <div className="data-table users-table">
                    <div className="data-table-header">
                      <div>User</div>
                      <div>Email</div>
                      <div>Role</div>
                      <div>Status</div>
                      <div>Created</div>
                      <div>Actions</div>
                    </div>
                    {visibleUsers.map((user) => (
                      <div className="data-table-row" key={user.id}>
                        <div className="user-cell">
                          <span className="user-avatar">
                            {initials(user.name || user.email || "User")}
                          </span>
                          <strong>{user.name || "Unnamed user"}</strong>
                        </div>
                        <div>{user.email || "—"}</div>
                        <div>
                          <span className={`user-role-badge ${user.role}`}>
                            {roleLabel(user.role)}
                          </span>
                        </div>
                        <div>
                          <span className={`user-status-badge ${user.status}`}>
                            {user.status === "active" ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div>{formatDate(user.createdAt)}</div>
                        <div className="user-action-wrap">
                          <button
                            className="user-action"
                            type="button"
                            aria-label={`View actions for ${user.name || "user"}`}
                            onClick={() =>
                              setOpenMenuId(
                                openMenuId === user.id ? null : user.id,
                              )
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {openMenuId === user.id && (
                            <div className="user-action-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedUser(user);
                                  setOpenMenuId(null);
                                }}
                              >
                                <Eye size={14} /> View Profile
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="users-pagination">
                    <span>
                      Showing {(page - 1) * pageSize + 1}-
                      {Math.min(page * pageSize, filteredUsers.length)} of{" "}
                      {filteredUsers.length} users
                    </span>
                    {totalPages > 1 && (
                      <div>
                        <button
                          type="button"
                          disabled={page === 1}
                          onClick={() => setPage((current) => current - 1)}
                        >
                          Previous
                        </button>
                        {Array.from(
                          { length: totalPages },
                          (_, index) => index + 1,
                        ).map((number) => (
                          <button
                            className={page === number ? "active" : ""}
                            type="button"
                            key={number}
                            onClick={() => setPage(number)}
                          >
                            {number}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={page === totalPages}
                          onClick={() => setPage((current) => current + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="users-empty-state">
                  <Users size={28} />
                  <h3>
                    {users.length
                      ? "No users found"
                      : "No staff accounts found"}
                  </h3>
                  <p>
                    {users.length
                      ? "No accounts match the selected filters."
                      : "There are no additional staff accounts to display."}
                  </p>
                  {users.length === 0 ? (
                    <small>
                      New staff accounts are provisioned by an administrator.
                    </small>
                  ) : (
                    hasFilters && (
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={clearFilters}
                      >
                        <X size={14} /> Clear filters
                      </button>
                    )
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {selectedUser && (
          <div
            className="modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedUser(null);
            }}
          >
            <section
              className="user-details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-details-title"
            >
              <div className="modal-header">
                <div>
                  <p className="users-section-kicker">User Details</p>
                  <h2 id="user-details-title">
                    {selectedUser.name || "Unnamed user"}
                  </h2>
                </div>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close user details"
                  onClick={() => setSelectedUser(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <dl className="user-details-list">
                <div>
                  <dt>Name</dt>
                  <dd>{selectedUser.name || "Not available"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedUser.email || "Not available"}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>
                    <span className={`user-role-badge ${selectedUser.role}`}>
                      {roleLabel(selectedUser.role)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={`user-status-badge ${selectedUser.status}`}
                    >
                      {selectedUser.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(selectedUser.createdAt)}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
