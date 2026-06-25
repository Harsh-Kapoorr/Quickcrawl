import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quickcrawl — submit URLs to Google's index",
  description:
    "Bulk-submit URLs to Google's Indexing API through your verified Search Console properties. Secure, local, and fast.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-bg text-fg font-sans antialiased">
        <Navbar />
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}