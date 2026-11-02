"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { supabase } from "@/lib/supabase/client";
import type { Customer } from "@/types/database.types";

type CustomerRow = Customer & {
  order_count: number;
  reservation_count: number;
  total_spent: number;
  last_visit: string;
};

type Filter = "all" | "new" | "returning" | "active";

const formatPeso = (value: number) =>
  `₱${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const displayDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("recent");
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadCustomers() {
    const { data } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });
    const rows = (data as Customer[]) || [];

    const withCounts = await Promise.all(
      rows.map(async (customer) => {
        const [ordersRes, reservationsRes] = await Promise.all([
          supabase
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("customer_id", customer.id),
          supabase
            .from("reservations")
            .select("id", { count: "exact", head: true })
            .eq("phone", customer.phone),
        ]);

        const { data: orders } = await supabase
          .from("orders")
          .select("total, created_at")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false });
        return {
          ...customer,
          order_count: ordersRes.count || 0,
          reservation_count: reservationsRes.count || 0,
          total_spent: (orders || []).reduce(
            (sum, order) => sum + Number(order.total),
            0,
          ),
          last_visit: orders?.[0]?.created_at || customer.created_at,
        };
      }),
    );

    setCustomers(withCounts);
    setLoading(false);
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const normalized = search.toLowerCase().trim();
    return customers
      .filter((customer) => {
        const matchesSearch =
          !normalized ||
          [customer.name, customer.email, customer.phone].some((value) =>
            value?.toLowerCase().includes(normalized),
          );
        const age = Date.now() - new Date(customer.created_at).getTime();
        if (filter === "new")
          return matchesSearch && age < 1000 * 60 * 60 * 24 * 45;
        if (filter === "returning")
          return matchesSearch && customer.order_count >= 5;
        if (filter === "active")
          return matchesSearch && customer.order_count >= 10;
        return matchesSearch;
      })
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "orders"
            ? b.order_count - a.order_count
            : new Date(b.last_visit).getTime() -
              new Date(a.last_visit).getTime(),
      );
  }, [customers, filter, search, sort]);

  const stats = useMemo(
    () => ({
      total: customers.length,
      newThisMonth: customers.filter(
        (customer) =>
          new Date(customer.created_at).getMonth() === new Date().getMonth(),
      ).length,
      returning: customers.length
        ? Math.round(
            (customers.filter((customer) => customer.order_count >= 5).length /
              customers.length) *
              100,
          )
        : 0,
      average: customers.length
        ? customers.reduce((sum, customer) => sum + customer.total_spent, 0) /
          customers.length
        : 0,
    }),
    [customers],
  );

  const saveCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || "").trim(),
      email: String(form.get("email") || "").trim() || null,
      phone: String(form.get("phone") || "").trim(),
      notes: String(form.get("notes") || "").trim() || null,
    };
    if (!payload.name || !payload.phone) return;
    if (editing) {
      const { data, error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", editing.id)
        .select("*")
        .single();
      if (error) {
        setNotice("Could not update this customer.");
        return;
      }
      setCustomers((current) =>
        current.map((customer) =>
          customer.id === editing.id
            ? {
                ...customer,
                ...(data as Customer),
                last_visit: customer.last_visit,
              }
            : customer,
        ),
      );
      setNotice("Customer updated.");
    } else {
      const { data, error } = await supabase
        .from("customers")
        .insert(payload)
        .select("*")
        .single();
      if (error) {
        setNotice("Could not add this customer.");
        return;
      }
      setCustomers((current) => [
        {
          ...(data as Customer),
          order_count: 0,
          reservation_count: 0,
          total_spent: 0,
          last_visit: (data as Customer).created_at,
        },
        ...current,
      ]);
      setNotice("Customer added.");
    }
    setEditing(null);
  };

  const deleteCustomer = async (customer: CustomerRow) => {
    setMenuId(null);
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", customer.id);
    if (error) {
      setNotice("Could not delete this customer.");
      return;
    }
    setCustomers((current) =>
      current.filter((item) => item.id !== customer.id),
    );
    if (selected?.id === customer.id) setSelected(null);
    setNotice("Customer deleted.");
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <RoleGuard allow={["admin", "staff"]} redirect="/dashboard">
      <div className="customers-page">
        <button
          className="dashboard-back customers-back"
          type="button"
          onClick={handleBack}
          aria-label="Go back to the previous page"
        >
          <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
          <span>Back</span>
        </button>
        <div className="page-toolbar customers-heading">
          <div>
            <p className="customers-kicker">Customers</p>
            <h2>Registered customers</h2>
            <p>Manage customer information, order history, and reservations.</p>
          </div>
        </div>

        {notice && (
          <button className="customers-notice" onClick={() => setNotice(null)}>
            {notice}
            <X size={14} />
          </button>
        )}

        <div className="customers-stat-grid">
          <div className="customer-stat">
            <span>
              <UsersRound size={15} /> Total Customers
            </span>
            <strong>{stats.total.toLocaleString()}</strong>
            <small>All registered guests</small>
          </div>
          <div className="customer-stat">
            <span>
              <TrendingUp size={15} /> New This Month
            </span>
            <strong>{stats.newThisMonth}</strong>
            <small>Recently joined</small>
          </div>
          <div className="customer-stat">
            <span>
              <UserRound size={15} /> Returning Customers
            </span>
            <strong>{stats.returning}%</strong>
            <small>5+ completed orders</small>
          </div>
          <div className="customer-stat">
            <span>
              <TrendingUp size={15} /> Average Spend
            </span>
            <strong>{formatPeso(stats.average)}</strong>
            <small>Per customer</small>
          </div>
        </div>

        {loading ? (
          <div className="bo-loading">Loading customers…</div>
        ) : (
          <>
            <div className="customers-toolbar">
              <label className="customer-search">
                <Search size={16} />
                <input
                  placeholder="Search customers..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="customer-filter-tabs">
                {(
                  [
                    ["all", "All Customers"],
                    ["new", "New Customers"],
                    ["returning", "Returning"],
                    ["active", "Most Active"],
                  ] as [Filter, string][]
                ).map(([value, label]) => (
                  <button
                    className={filter === value ? "active" : ""}
                    key={value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="customer-sort">
                <SlidersHorizontal size={14} />
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="recent">Recent Activity</option>
                  <option value="name">Name</option>
                  <option value="orders">Total Orders</option>
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
            {filteredCustomers.length === 0 ? (
              <div className="customer-empty">
                <UsersRound size={28} />
                <h3>No customers found</h3>
                <p>
                  Customers will appear here once they register or place an
                  order.
                </p>
              </div>
            ) : (
              <div className="customer-table-wrap">
                <div className="customer-table">
                  <div className="customer-table-header">
                    <span>Customer</span>
                    <span>Email</span>
                    <span>Phone</span>
                    <span>Orders</span>
                    <span>Reservations</span>
                    <span>Total Spent</span>
                    <span>Last Visit</span>
                    <span>Status</span>
                    <span />
                  </div>
                  {filteredCustomers.map((customer) => (
                    <div
                      className="customer-table-row"
                      key={customer.id}
                      onClick={() => setSelected(customer)}
                    >
                      <div className="customer-name-cell">
                        <span className="customer-avatar">
                          {initials(customer.name)}
                        </span>
                        <strong>{customer.name}</strong>
                      </div>
                      <span className="customer-secondary">
                        {customer.email || "—"}
                      </span>
                      <span className="customer-secondary">
                        {customer.phone}
                      </span>
                      <strong>{customer.order_count}</strong>
                      <span>{customer.reservation_count}</span>
                      <strong>{formatPeso(customer.total_spent)}</strong>
                      <span className="customer-secondary">
                        {displayDate(customer.last_visit)}
                      </span>
                      <span
                        className={`customer-status ${customer.order_count ? "active" : "inactive"}`}
                      >
                        {customer.order_count ? "Active" : "Inactive"}
                      </span>
                      <div className="customer-actions">
                        <button
                          aria-label={`Actions for ${customer.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuId(
                              menuId === customer.id ? null : customer.id,
                            );
                          }}
                        >
                          <MoreHorizontal size={17} />
                        </button>
                        {menuId === customer.id && (
                          <div className="customer-action-menu">
                            <button
                              onClick={() => {
                                setSelected(customer);
                                setMenuId(null);
                              }}
                            >
                              View details
                            </button>
                            <button
                              onClick={() => {
                                setEditing(customer);
                                setMenuId(null);
                              }}
                            >
                              Edit customer
                            </button>
                            <button
                              className="danger"
                              onClick={() => deleteCustomer(customer)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {selected && (
          <CustomerDetails
            customer={selected}
            onClose={() => setSelected(null)}
            onEdit={() => {
              setEditing(selected);
              setSelected(null);
            }}
          />
        )}
        {editing && (
          <CustomerForm
            customer={editing}
            onClose={() => {
              setEditing(null);
            }}
            onSubmit={saveCustomer}
          />
        )}

      </div>
    </RoleGuard>
  );
}

function CustomerDetails({
  customer,
  onClose,
  onEdit,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="customer-modal-overlay" onClick={onClose}>
      <aside
        className="customer-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="customer-drawer-header">
          <span>Customer profile</span>
          <button onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>
        <div className="customer-profile">
          <span className="customer-avatar customer-avatar-large">
            {initials(customer.name)}
          </span>
          <h2>{customer.name}</h2>
          <p>{customer.email || "No email provided"}</p>
          <span
            className={`customer-status ${customer.order_count ? "active" : "inactive"}`}
          >
            {customer.order_count ? "Active customer" : "Inactive customer"}
          </span>
        </div>
        <div className="customer-detail-stats">
          <div>
            <strong>{customer.order_count}</strong>
            <span>Total orders</span>
          </div>
          <div>
            <strong>{formatPeso(customer.total_spent)}</strong>
            <span>Total spent</span>
          </div>
          <div>
            <strong>{customer.reservation_count}</strong>
            <span>Reservations</span>
          </div>
        </div>
        <div className="customer-contact">
          <p>Contact information</p>
          <span>{customer.phone}</span>
          <span>{customer.email || "No email provided"}</span>
          <p>Last visit</p>
          <span>{displayDate(customer.last_visit)}</span>
        </div>
        <div className="customer-drawer-footer">
          <button className="btn-primary" onClick={onEdit}>
            Edit Customer
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}

function CustomerForm({
  customer,
  onClose,
  onSubmit,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="customer-modal-overlay" onClick={onClose}>
      <div
        className="customer-form-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="customers-kicker">Customers</p>
            <h2>{customer ? "Edit customer" : "Add customer"}</h2>
          </div>
          <button
            className="bo-topbar-icon"
            onClick={onClose}
            aria-label="Close form"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body customer-form-body">
            <label className="form-field">
              <span>Full name</span>
              <input name="name" defaultValue={customer?.name || ""} required />
            </label>
            <label className="form-field">
              <span>Email address</span>
              <input
                type="email"
                name="email"
                defaultValue={customer?.email || ""}
              />
            </label>
            <label className="form-field">
              <span>Phone number</span>
              <input
                name="phone"
                defaultValue={customer?.phone || ""}
                required
              />
            </label>
            <label className="form-field">
              <span>Notes</span>
              <textarea
                name="notes"
                defaultValue={customer?.notes || ""}
                rows={3}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {customer ? "Save changes" : "Add customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
