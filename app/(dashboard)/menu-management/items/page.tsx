"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Upload,
  Link2,
  Image as ImageIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { MenuItemWithCategory, Category } from "@/types/database.types";

function formatP(n: number) {
  return "₱" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

// Supabase Storage bucket that persists uploaded menu-item photos. Created by
// migration 20261016000000_menu_images_storage.sql.
const IMAGE_BUCKET = "menu-images";
// Client-side guardrails; the bucket also enforces these server-side via the
// migration's file_size_limit / allowed_mime_types.
const MAX_IMAGE_MB = 5;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];
const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(",");

export default function MenuItemsPage() {
  const [items, setItems] = useState<MenuItemWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmClosing, setDeleteConfirmClosing] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuItemWithCategory | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    category_id: "",
    prep_time: "15",
    image_url: "",
    available: true,
  });
  // --- Image selection (upload a file OR paste a URL) ---------------------
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks object URLs we create so we can revoke them and never leak memory
  // or accidentally persist a blob: preview URL in the DB.
  const objectUrlRef = useRef<string | null>(null);

  // Reset all image state whenever the modal opens for a fresh create/edit so
  // the previous selection never leaks into a new menu item.
  const resetImageState = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setImageError(null);
    setDragActive(false);
    setImageMode("upload");
  }, []);

  const validateAndPreviewFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setImageError(
          `Unsupported format "${file.type || "unknown"}". Use PNG, JPG, JPEG, WEBP, or GIF.`,
        );
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError(
          `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum size is ${MAX_IMAGE_MB} MB.`,
        );
        return;
      }
      setImageError(null);
      setSelectedFile(file);
      // A pending upload always wins over a pasted URL; clear the URL field so
      // the DB stores the uploaded image, not the stale link.
      setForm((prev) => ({ ...prev, image_url: "" }));
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPreviewUrl(url);
    },
    [],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndPreviewFile(e.target.files?.[0]);
    // Allow re-selecting the same file after a remove (clears the input value).
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    validateAndPreviewFile(e.dataTransfer.files?.[0]);
  };

  // Remove any image (file or URL) and return to the empty state.
  const removeImage = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setImageError(null);
    setForm((prev) => ({ ...prev, image_url: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const switchImageMode = (mode: "upload" | "url") => {
    if (mode === imageMode) return;
    setImageError(null);
    setDragActive(false);
    if (mode === "url") {
      // Switching to URL: discard any pending file and its preview.
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setSelectedFile(null);
      setPreviewUrl(null);
    } else {
      // Switching to upload: keep the URL text but clear the live preview so a
      // broken link doesn't linger until the staff picks a file.
      setPreviewUrl(null);
    }
    setImageMode(mode);
  };

  // Live preview when a URL is typed (used by the <img onLoad>/<onError>).
  const urlPreview = imageMode === "url" ? form.image_url.trim() : "";
  const [urlStatus, setUrlStatus] = useState<"idle" | "ok" | "error">("idle");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("menu_items")
      .select("*, categories(name)")
      .order("name");
    setItems((data as MenuItemWithCategory[]) || []);
    const { data: cats } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order");
    setCategories((cats as Category[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // While the modal is open: close on Escape and lock background scrolling so
  // the page behind doesn't move and the modal stays the focus of attention.
  useEffect(() => {
    if (!showForm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowForm(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [showForm]);

  const filtered = items.filter((item) => {
    const matchSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "all" || item.category_id === filterCat;
    return matchSearch && matchCat;
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      description: "",
      price: "",
      category_id: categories[0]?.id || "",
      prep_time: "15",
      image_url: "",
      available: true,
    });
    resetImageState();
    setUrlStatus("idle");
    setShowForm(true);
  };
  const openEdit = (item: MenuItemWithCategory) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description || "",
      price: String(item.price),
      category_id: item.category_id || "",
      prep_time: String(item.prep_time),
      image_url: item.image_url || "",
      available: item.available,
    });
    resetImageState();
    // An existing item stores a URL; open in URL mode so the staff sees and can
    // keep it, or clear it and switch to an upload.
    setImageMode("url");
    setUrlStatus(item.image_url ? "ok" : "idle");
    setShowForm(true);
  };

  // Upload the chosen file to Supabase Storage and return its persistent public
  // URL. Throws on failure so handleSave can surface a clear message.
  const uploadImage = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "png";
    const path = `${Date.now()}-${crypto.randomUUID()}.${safeExt}`;
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, file, {
        cacheControl: "31536000",
        upsert: false,
        contentType: file.type,
      });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.price || !form.category_id) return;
    if (imageError) return;
    setUploading(true);
    let resolvedImageUrl = form.image_url.trim() || null;
    try {
      // If a file is pending, upload it now (on Save) and persist the returned
      // public URL — never the temporary blob: preview URL.
      if (selectedFile) {
        resolvedImageUrl = await uploadImage(selectedFile);
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price),
        category_id: form.category_id,
        prep_time: parseInt(form.prep_time) || 15,
        image_url: resolvedImageUrl,
        available: form.available,
      };
      const result = editing
        ? await supabase.from("menu_items").update(payload).eq("id", editing.id)
        : await supabase.from("menu_items").insert(payload);
      if (result.error) throw new Error(result.error.message);
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : "Failed to save the menu item.",
      );
      setUploading(false);
      return;
    }
    setUploading(false);
    setShowForm(false);
    load();
  };

  const handleDelete = (id: string) => {
    setDeletingItemId(id);
    setDeleteConfirmClosing(false);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirmClosing(true);
    setTimeout(() => {
      setDeleteConfirmClosing(false);
      setDeleteConfirmOpen(false);
      setDeletingItemId(null);
    }, 200);
  }, []);

  useEffect(() => {
    if (!deleteConfirmOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDeleteConfirm();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmOpen, closeDeleteConfirm]);

  const handleDeleteConfirm = async () => {
    const id = deletingItemId;
    if (!id) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) {
      alert(
        "Cannot delete: this item is referenced by existing orders. Mark it unavailable instead.",
      );
      closeDeleteConfirm();
      return;
    }
    load();
    closeDeleteConfirm();
  };

  const toggleAvailable = async (item: MenuItemWithCategory) => {
    await supabase
      .from("menu_items")
      .update({ available: !item.available })
      .eq("id", item.id);
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
              placeholder="Search menu items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={16} /> Add Item
        </button>
      </div>

      {loading ? (
        <div className="bo-loading">Loading menu items…</div>
      ) : (
        <div className="menu-grid">
          {filtered.map((item) => (
            <div key={item.id} className="menu-item-card">
              <div className="menu-item-img">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt={item.name} />
                ) : (
                  <div className="menu-item-placeholder" />
                )}
              </div>
              <div className="menu-item-body">
                <div className="menu-item-top">
                  <h3>{item.name}</h3>
                  <span
                    className={`status-badge status-${item.available ? "available" : "unavailable"}`}
                  >
                    {item.available ? "Available" : "Unavailable"}
                  </span>
                </div>
                <p className="menu-item-cat">{item.categories?.name}</p>
                <p className="menu-item-desc">{item.description}</p>
                <div className="menu-item-bottom">
                  <span className="menu-item-price">{formatP(item.price)}</span>
                  <span className="menu-item-prep">{item.prep_time} min</span>
                </div>
                <div className="menu-item-actions">
                  <button
                    className="btn-icon"
                    onClick={() => openEdit(item)}
                    aria-label="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => toggleAvailable(item)}
                  >
                    {item.available ? "Mark Off" : "Mark On"}
                  </button>
                  <button
                    className="btn-icon danger"
                    onClick={() => handleDelete(item.id)}
                    aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div
          className="modal-overlay menu-modal-overlay"
          onClick={() => !uploading && setShowForm(false)}
        >
          <div
            className="modal-content menu-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="menu-modal-heading">
                <h2 id="menu-modal-title">
                  {editing ? "Edit Item" : "New Menu Item"}
                </h2>
                <p className="menu-modal-subtitle">
                  {editing
                    ? "Update this dish and save your changes."
                    : "Add a new dish to your menu."}
                </p>
              </div>
              <button
                className="btn-icon menu-modal-close"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body menu-modal-body">
              <div className="form-field">
                <label htmlFor="menu-name">Name</label>
                <input
                  id="menu-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label htmlFor="menu-category">Category</label>
                <select
                  id="menu-category"
                  value={form.category_id}
                  onChange={(e) =>
                    setForm({ ...form, category_id: e.target.value })
                  }
                >
                  {categories.length === 0 ? (
                    <option value="" disabled>
                      No categories available — add one first
                    </option>
                  ) : (
                    <>
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label htmlFor="menu-price">Price (₱)</label>
                  <input
                    id="menu-price"
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="menu-prep">Prep Time (min)</label>
                  <input
                    id="menu-prep"
                    type="number"
                    value={form.prep_time}
                    onChange={(e) =>
                      setForm({ ...form, prep_time: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="menu-description">Description</label>
                <textarea
                  id="menu-description"
                  rows={2}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              {/* Image: upload a file OR paste a URL. Both produce the same
                  stored `image_url`; uploads go to Supabase Storage on Save. */}
              <div className="form-field menu-image-field">
                <span className="menu-image-label">Image</span>
                <div
                  className="menu-image-toggle"
                  role="tablist"
                  aria-label="Image source"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={imageMode === "upload"}
                    className={`menu-image-tab ${imageMode === "upload" ? "active" : ""}`}
                    onClick={() => switchImageMode("upload")}
                  >
                    <Upload size={14} aria-hidden="true" /> Upload Image
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={imageMode === "url"}
                    className={`menu-image-tab ${imageMode === "url" ? "active" : ""}`}
                    onClick={() => switchImageMode("url")}
                  >
                    <Link2 size={14} aria-hidden="true" /> Image URL
                  </button>
                </div>

                {imageMode === "upload" ? (
                  <div
                    className={`menu-dropzone ${dragActive ? "drag-active" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload an image from your device"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPT_ATTR}
                      onChange={onFileInputChange}
                      className="menu-file-input"
                      tabIndex={-1}
                    />
                    <Upload size={20} aria-hidden="true" />
                    <span className="menu-dropzone-title">
                      Click to browse or drag &amp; drop
                    </span>
                    <span className="menu-dropzone-hint">
                      PNG, JPG, JPEG, WEBP or GIF · up to {MAX_IMAGE_MB} MB
                    </span>
                  </div>
                ) : (
                  <input
                    id="menu-image-url"
                    className="menu-url-input"
                    type="text"
                    value={form.image_url}
                    onChange={(e) => {
                      setForm({ ...form, image_url: e.target.value });
                      setImageError(null);
                      setUrlStatus("idle");
                    }}
                    placeholder="https://example.com/dish.jpg"
                  />
                )}

                {imageMode === "upload" && previewUrl && (
                  <div className="menu-image-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="Selected menu item preview" />
                    <div className="menu-image-meta">
                      <span
                        className="menu-image-name"
                        title={selectedFile?.name}
                      >
                        {selectedFile?.name}
                      </span>
                      <div className="menu-image-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          onClick={removeImage}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {imageMode === "url" && urlPreview && (
                  <div className="menu-image-preview">
                    {urlStatus === "error" ? (
                      <div className="menu-image-fallback">
                        <ImageIcon size={22} aria-hidden="true" />
                        <span>Couldn’t load this image URL.</span>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={urlPreview}
                        alt="Menu item preview"
                        onLoad={() => setUrlStatus("ok")}
                        onError={() => setUrlStatus("error")}
                      />
                    )}
                    <div className="menu-image-meta">
                      <span
                        className={`menu-image-name ${urlStatus === "error" ? "error" : ""}`}
                      >
                        {urlStatus === "ok"
                          ? "Image loaded"
                          : urlStatus === "error"
                            ? "Invalid or unreachable URL"
                            : "Loading preview…"}
                      </span>
                      <div className="menu-image-actions">
                        <button
                          type="button"
                          className="btn-icon danger"
                          onClick={removeImage}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {imageError && (
                  <p className="menu-image-error" role="alert">
                    {imageError}
                  </p>
                )}
              </div>

              <div className="form-field menu-available-field">
                <label className="checkbox-label" htmlFor="menu-available">
                  <input
                    id="menu-available"
                    type="checkbox"
                    checked={form.available}
                    onChange={(e) =>
                      setForm({ ...form, available: e.target.checked })
                    }
                  />{" "}
                  Available
                </label>
              </div>
            </div>
            <div className="modal-footer menu-modal-footer">
              <button
                className="btn-ghost"
                onClick={() => setShowForm(false)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={uploading}
              >
                {uploading ? "Saving…" : editing ? "Save" : "Create Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmOpen && (
        <div
          className={`modal-overlay menu-delete-confirm-overlay${deleteConfirmClosing ? " menu-delete-confirm-closing" : ""}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteConfirm();
          }}
        >
          <div
            className={`modal-content menu-delete-confirm${deleteConfirmClosing ? " menu-delete-confirm--closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Delete Menu Item?"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete Menu Item?</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeDeleteConfirm}
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete this menu item? If it has
                historical orders, consider marking it unavailable instead.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={closeDeleteConfirm}>
                Cancel
              </button>
              <button type="button" className="res-btn-danger" onClick={handleDeleteConfirm}>
                Delete Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
