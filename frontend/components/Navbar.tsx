"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";
import { cn } from "@/lib/utils";
import { clearTokens, getTokens } from "@/lib/store";

const MARKETING_NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
];

const APP_NAV = [
  { href: "/", label: "Submit" },
  { href: "/batches", label: "Batches" },
  { href: "/inspect", label: "Inspect" },
  { href: "/settings", label: "Settings" },
];

export function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const t = getTokens();
    setSignedIn(Boolean(t));
    setEmail(t?.email ?? null);
  }, [pathname]);

  const onLogout = () => {
    clearTokens();
    setSignedIn(false);
    router.push("/welcome");
  };

  // Public marketing layout — logo left, nothing on the right.
  if (pathname === "/welcome" || pathname === "/welcome/") {
    return (
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-20 max-w-6xl items-center px-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Logo size={48} showWordmark />
          </Link>
        </div>
      </header>
    );
  }

  // App layout — signed-in users see the dashboard nav.
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Logo size={36} showWordmark />
        </Link>
        <nav className="flex flex-1 items-center gap-0.5">
          {APP_NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm transition-colors",
                  active
                    ? "text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <>
              <span className="hidden text-xs text-fg-muted sm:inline">{email}</span>
              <Button variant="ghost" size="sm" onClick={onLogout}>
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => router.push("/welcome")}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}