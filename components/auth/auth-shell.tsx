"use client";

import { ReactNode } from "react";
import Link from "next/link";

export function AuthShell({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="auth-page">
      <div className="auth-bg" />
      <div className="grain" />
      <header className="auth-header">
        <Link href="/" className="wordmark">
          QITCHEN
        </Link>
        <Link href="/" className="back-link">
          ← Back to site
        </Link>
      </header>
      <div className="auth-card-wrap">
        <div className="auth-card">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="auth-title">{title}</h1>
          {children}
        </div>
      </div>
      <footer className="auth-footer">
        <span>© 2024 Qitchen Manila</span>
        <a href="mailto:hello@qitchen.ph">hello@qitchen.ph</a>
      </footer>
    </main>
  );
}
