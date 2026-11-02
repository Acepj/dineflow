"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";

export default function ProfilePage() {
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!session?.user) {
        setLoading(false);
        return;
      }

      setName(session.user.user_metadata?.full_name || "");
      setEmail(session.user.email || "");

      const { data: customer } = await supabase
        .from("customers")
        .select("phone")
        .eq("user_id", session.user.id)
        .maybeSingle();

      setPhone(customer?.phone || "");
      setLoading(false);
    }

    load();
  }, [session]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      if (session?.user) {
        const { error: userError } = await supabase.auth.updateUser({
          data: { full_name: name.trim() },
        });
        if (userError) throw userError;
      }

      if (session?.user?.id) {
        await supabase.from("customers").upsert({
          user_id: session.user.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
        });
      }

      setMessage("Profile updated.");
    } catch {
      setMessage("Unable to save profile details right now.");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordMessage(null);
    if (newPassword.length < 6) {
      setPasswordMessage("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setPasswordSaving(false);

    if (error) {
      setPasswordMessage(error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordOpen(false);
    setPasswordMessage("Password updated successfully.");
  };

  const user = session?.user;
  const displayName = name.trim() || user?.email?.split("@")[0] || "Admin User";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const role = user?.user_metadata?.role || user?.app_metadata?.role;
  const roleLabel = role === "admin" ? "Administrator" : role || "Account user";
  const formatAccountDate = (value?: string | null) =>
    value
      ? new Date(value).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <RoleGuard allow={["user", "staff", "admin"]} redirect="/dashboard">
      <div className="profile-page">
        <DashboardBackButton />
        <div className="profile-page-header">
          <p className="profile-kicker">Profile</p>
          <h2>Manage account</h2>
          <p>
            Manage your administrator profile, account information, and security
            settings.
          </p>
        </div>

        {loading ? (
          <div className="bo-loading">Loading profile…</div>
        ) : (
          <>
            <section
              className="profile-card profile-overview"
              aria-labelledby="profile-overview-title"
            >
              <div className="profile-avatar" aria-hidden="true">
                {initials}
              </div>
              <div className="profile-overview-copy">
                <p className="profile-card-kicker">Profile overview</p>
                <h3 id="profile-overview-title">{displayName}</h3>
                <p>{email || "No email address"}</p>
                <div className="profile-status-row">
                  <span>{roleLabel}</span>
                  <span className="profile-status">
                    <Check size={12} /> Active
                  </span>
                </div>
              </div>
            </section>

            <div className="profile-content-grid">
              <section
                className="profile-card profile-personal"
                aria-labelledby="personal-info-title"
              >
                <div className="profile-card-heading">
                  <div className="profile-section-icon">
                    <UserRound size={17} />
                  </div>
                  <div>
                    <h3 id="personal-info-title">Personal Information</h3>
                    <p>
                      Update the information associated with your administrator
                      account.
                    </p>
                  </div>
                </div>

                {message && <div className="profile-message">{message}</div>}

                <div className="profile-form">
                  <div className="form-field">
                    <label htmlFor="profile-name">Name</label>
                    <input
                      id="profile-name"
                      value={name}
                      placeholder="Your full name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="profile-email">Email</label>
                    <div className="profile-input-with-icon">
                      <Mail size={15} aria-hidden="true" />
                      <input
                        id="profile-email"
                        type="email"
                        value={email}
                        readOnly
                        aria-describedby="profile-email-note"
                      />
                    </div>
                    <span
                      id="profile-email-note"
                      className="profile-field-note"
                    >
                      Authentication email is managed by your account.
                    </span>
                  </div>
                  <div className="form-field">
                    <label htmlFor="profile-phone">Phone</label>
                    <div className="profile-input-with-icon">
                      <Phone size={15} aria-hidden="true" />
                      <input
                        id="profile-phone"
                        value={phone}
                        placeholder="Add a phone number"
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="profile-form-actions">
                  <button
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </section>

              <div className="profile-side-column">
                <section
                  className="profile-card"
                  aria-labelledby="security-title"
                >
                  <div className="profile-card-heading">
                    <div className="profile-section-icon">
                      <ShieldCheck size={17} />
                    </div>
                    <div>
                      <h3 id="security-title">Security</h3>
                      <p>Manage your password and account security.</p>
                    </div>
                  </div>
                  <div className="profile-action-row">
                    <div>
                      <strong>Change Password</strong>
                      <span>Reset or change the administrator password.</span>
                    </div>
                    <button
                      className="btn-ghost profile-action-button"
                      type="button"
                      onClick={() => {
                        setPasswordOpen((open) => !open);
                        setPasswordMessage(null);
                      }}
                    >
                      <LockKeyhole size={14} />{" "}
                      {passwordOpen ? "Cancel" : "Change Password"}
                    </button>
                  </div>
                  {passwordOpen && (
                    <div className="profile-password-form">
                      <div className="form-field">
                        <label htmlFor="new-password">New password</label>
                        <input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          autoComplete="new-password"
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label htmlFor="confirm-password">
                          Confirm password
                        </label>
                        <input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          autoComplete="new-password"
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                      </div>
                      {passwordMessage && (
                        <p className="profile-inline-message">
                          {passwordMessage}
                        </p>
                      )}
                      <button
                        className="btn-primary"
                        type="button"
                        onClick={handlePasswordChange}
                        disabled={passwordSaving}
                      >
                        {passwordSaving ? "Saving..." : "Update Password"}
                      </button>
                    </div>
                  )}
                  {!passwordOpen && passwordMessage && (
                    <p className="profile-inline-message">{passwordMessage}</p>
                  )}
                </section>

                <section
                  className="profile-card"
                  aria-labelledby="account-info-title"
                >
                  <div className="profile-card-heading">
                    <div className="profile-section-icon">
                      <Clock3 size={17} />
                    </div>
                    <div>
                      <h3 id="account-info-title">Account Information</h3>
                      <p>Details from your authenticated account.</p>
                    </div>
                  </div>
                  <dl className="profile-account-list">
                    <div>
                      <dt>Role</dt>
                      <dd>{roleLabel}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span className="profile-status-dot" /> Active
                      </dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{email || "Not available"}</dd>
                    </div>
                    {formatAccountDate(user?.created_at) && (
                      <div>
                        <dt>Account Created</dt>
                        <dd>{formatAccountDate(user?.created_at)}</dd>
                      </div>
                    )}
                    {formatAccountDate(user?.last_sign_in_at) && (
                      <div>
                        <dt>Last Login</dt>
                        <dd>{formatAccountDate(user?.last_sign_in_at)}</dd>
                      </div>
                    )}
                  </dl>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </RoleGuard>
  );
}
