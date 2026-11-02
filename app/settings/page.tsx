"use client";

import { useMemo, useState } from "react";
import { Clock3, MapPin, Phone, Save, Store } from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";

type RestaurantSettings = {
  restaurantName: string;
  address: string;
  phone: string;
  openingHours: string;
  closingHours: string;
};

const defaultSettings: RestaurantSettings = {
  restaurantName: "Qitchen",
  address: "Manila, Philippines",
  phone: "+63 917 000 2000",
  openingHours: "5:30PM",
  closingHours: "23:00",
};

export default function SettingsPage() {
  const { session } = useAuth();
  const storedSettings = session?.user?.user_metadata?.restaurant_settings as
    | Partial<RestaurantSettings>
    | undefined;
  const [settings, setSettings] = useState<RestaurantSettings>(() => ({
    ...defaultSettings,
    ...storedSettings,
  }));
  const [savedSettings, setSavedSettings] =
    useState<RestaurantSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings],
  );

  const updateSetting = (key: keyof RestaurantSettings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(null);
    setError(null);
  };

  const handleSave = async () => {
    setMessage(null);
    setError(null);

    if (!settings.restaurantName.trim() || !settings.address.trim()) {
      setError("Restaurant name and address are required.");
      return;
    }
    if (!settings.openingHours || !settings.closingHours) {
      setError("Opening and closing hours are required.");
      return;
    }
    if (settings.openingHours >= settings.closingHours) {
      setError("Closing time must be later than opening time.");
      return;
    }
    if (!session?.user) {
      setError("Your session has expired. Please sign in again.");
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase.auth.updateUser({
      data: { restaurant_settings: settings },
    });
    setSaving(false);

    if (saveError) {
      setError("Unable to save restaurant settings right now.");
      return;
    }

    setSavedSettings(settings);
    setMessage("Settings saved successfully.");
  };

  return (
    <RoleGuard allow={["admin"]} redirect="/dashboard">
      <div className="settings-page">
        <DashboardBackButton />
        <header className="settings-page-header">
          <p className="settings-kicker">Settings</p>
          <h2>Restaurant settings</h2>
          <p>
            Manage your restaurant information, business hours, and operational
            settings.
          </p>
        </header>

        <div className="settings-grid">
          <section
            className="settings-card"
            aria-labelledby="restaurant-info-title"
          >
            <div className="settings-card-heading">
              <div className="settings-section-icon">
                <Store size={17} />
              </div>
              <div>
                <h3 id="restaurant-info-title">Restaurant Information</h3>
                <p>
                  Basic information customers and staff use to identify your
                  restaurant.
                </p>
              </div>
            </div>

            <div className="settings-form">
              <div className="form-field">
                <label htmlFor="restaurant-name">Restaurant Name</label>
                <div className="settings-input-with-icon">
                  <Store size={15} aria-hidden="true" />
                  <input
                    id="restaurant-name"
                    value={settings.restaurantName}
                    placeholder="Enter restaurant name"
                    onChange={(event) =>
                      updateSetting("restaurantName", event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="restaurant-address">Address</label>
                <div className="settings-input-with-icon">
                  <MapPin size={15} aria-hidden="true" />
                  <input
                    id="restaurant-address"
                    value={settings.address}
                    placeholder="Enter restaurant address"
                    onChange={(event) =>
                      updateSetting("address", event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="restaurant-phone">Phone</label>
                <div className="settings-input-with-icon">
                  <Phone size={15} aria-hidden="true" />
                  <input
                    id="restaurant-phone"
                    type="tel"
                    value={settings.phone}
                    placeholder="Enter restaurant phone"
                    onChange={(event) =>
                      updateSetting("phone", event.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <section
            className="settings-card"
            aria-labelledby="business-hours-title"
          >
            <div className="settings-card-heading">
              <div className="settings-section-icon">
                <Clock3 size={17} />
              </div>
              <div>
                <h3 id="business-hours-title">Business Hours</h3>
                <p>Set the hours when your restaurant is open for service.</p>
              </div>
            </div>

            <div className="settings-form">
              <div className="form-field">
                <label htmlFor="opening-hours">Opening Hours</label>
                <input
                  id="opening-hours"
                  className="settings-time-input"
                  type="time"
                  value={settings.openingHours}
                  aria-describedby={error ? "settings-error" : undefined}
                  onChange={(event) =>
                    updateSetting("openingHours", event.target.value)
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="closing-hours">Closing Hours</label>
                <input
                  id="closing-hours"
                  className="settings-time-input"
                  type="time"
                  value={settings.closingHours}
                  aria-describedby={error ? "settings-error" : undefined}
                  onChange={(event) =>
                    updateSetting("closingHours", event.target.value)
                  }
                />
              </div>
            </div>
            <p className="settings-hours-note">
              Use 24-hour time for consistent service scheduling.
            </p>
          </section>
        </div>

        <div className="settings-save-bar">
          <div aria-live="polite">
            {hasChanges && (
              <span className="settings-unsaved">
                You have unsaved changes.
              </span>
            )}
            {message && <span className="settings-success">{message}</span>}
            {error && (
              <span id="settings-error" className="settings-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button
            className="btn-primary settings-save-button"
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            <Save size={15} /> {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </RoleGuard>
  );
}
