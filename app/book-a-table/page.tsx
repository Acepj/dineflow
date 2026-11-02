"use client";

import Link from "next/link";
import { Loader2, Lock } from "lucide-react";
import BookingWizard from "@/components/marketing/booking-wizard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { useAuth } from "@/lib/auth/context";

export default function BookATablePage() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <main className="booking-page">
        <div className="booking-bg" />
        <div className="grain" />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100svh",
            color: "var(--muted)",
            fontSize: "14px",
          }}
        >
          <Loader2
            size={20}
            style={{ marginRight: "10px" }}
            className="animate-spin"
          />
          Loading...
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="booking-page">
        <div className="booking-bg" />
        <div className="grain" />
        <header className="booking-header">
          <Link href="/" className="wordmark">
            QITCHEN
          </Link>
          <DashboardBackButton />
        </header>

        <div className="booking-content booking-gate">
          <div className="booking-intro">
            <p className="eyebrow">Reservation</p>
            <h1>
              Please sign in
              <br />
              <em>to book.</em>
            </h1>
            <p className="booking-sub">
              Create an account or sign in to reserve your table and manage your
              booking details.
            </p>
          </div>

          <div className="booking-auth-card">
            <div className="booking-auth-icon">
              <Lock size={26} />
            </div>
            <h2>Sign in required</h2>
            <p>
              You need to be signed in before you can make a table reservation.
            </p>
            <div className="booking-gate-actions">
              <Link href="/sign-in" className="cream-button">
                Sign in
              </Link>
              <Link href="/sign-up" className="ghost-button">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="booking-page">
      <div className="booking-bg" />
      <div className="grain" />
      <header className="booking-header">
        <Link href="/" className="wordmark">
          QITCHEN
        </Link>
        <DashboardBackButton />
      </header>
      <div className="booking-content">
        <div className="booking-intro">
          <p className="eyebrow">Reservation</p>
          <h1>
            Book a<br />
            <em>table.</em>
          </h1>
          <p className="booking-sub">
            Open Tuesday — Sunday · 5:30 PM — 11:00 PM. Last seating at 9:30 PM.
            We hold your table for 15 minutes past the reservation time.
          </p>
        </div>
        <BookingWizard />
      </div>
    </main>
  );
}
