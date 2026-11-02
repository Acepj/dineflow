"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Pencil, Trash2, X, GripVertical } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { Category } from "@/types/database.types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<
    (Category & { item_count: number })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    sort_order: "0",
    active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order");
    const cats = (data as Category[]) || [];
    const withCounts = await Promise.all(
      cats.map(async (c) => {
        const { count } = await supabase
          .from("menu_items")
          .select("*", { count: "exact", head: true })
          .eq("category_id", c.id);
        return { ...c, item_count: count || 0 };
      }),
    );
    setCategories(withCounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", sort_order: "0", active: true });
    setShowForm(true);
  };
  const openEdit = (cat: Category) => {
    setEditing(cat);
    setForm({
      name: cat.name,
      description: cat.description || "",
      sort_order: String(cat.sort_order),
      active: cat.active,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      sort_order: parseInt(form.sort_order) || 0,
      active: form.active,
    };
    if (editing) {
      await supabase.from("categories").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("categories").insert(payload);
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string, count: number) => {
    if (count > 0) {
      alert(
        `Cannot delete: ${count} menu items use this category. Reassign them first.`,
      );
      return;
    }
    if (!confirm("Delete this category?")) return;
    await supabase.from("categories").delete().eq("id", id);
    load();
  };

  const toggleActive = async (cat: Category) => {
    await supabase
      .from("categories")
      .update({ active: !cat.active })
      .eq("id", cat.id);
    load();
  };

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-left">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search categories…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Category
        </button>
      </div>
      {loading ? (
        <div className="bo-loading">Loading…</div>
      ) : (
        <div className="data-table">
          <div className="data-table-header">
            <div>Order</div>
            <div>Name</div>
            <div>Description</div>
            <div>Items</div>
            <div>Status</div>
            <div>Actions</div>
          </div>
          {filtered.map((cat) => (
            <div key={cat.id} className="data-table-row">
              <div>
                <GripVertical size={14} className="text-faint" />{" "}
                {cat.sort_order}
              </div>
              <div>
                <strong>{cat.name}</strong>
              </div>
              <div className="text-muted">{cat.description || "—"}</div>
              <div>{cat.item_count}</div>
              <div>
                <span
                  className={`status-badge status-${cat.active ? "available" : "unavailable"}`}
                  onClick={() => toggleActive(cat)}
                  style={{ cursor: "pointer" }}
                >
                  {cat.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="row-actions">
                <button className="btn-icon" onClick={() => openEdit(cat)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="btn-icon danger"
                  onClick={() => handleDelete(cat.id, cat.item_count)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? "Edit Category" : "New Category"}</h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className="form-field">
                <label>Sort Order</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm({ ...form, sort_order: e.target.value })
                  }
                />
              </div>
              <div className="form-field">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm({ ...form, active: e.target.checked })
                    }
                  />{" "}
                  Active
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSave}>
                {editing ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
