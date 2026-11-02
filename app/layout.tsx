import "./globals.css";
import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { AuthProvider } from "@/lib/auth/context";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Qitchen — Contemporary Japanese Dining",
  description:
    "A quiet celebration of the sea, shaped by fire, season, and the hands that bring it to your table.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${cormorant.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
