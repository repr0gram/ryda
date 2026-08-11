"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const LINKS = [
  { href: "/", label: "Import" },
  { href: "/library", label: "Library" },
  { href: "/trend", label: "Trend" },
  { href: "/power", label: "Power" },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-[15px] font-medium tracking-tight text-ink">
            Ryda
          </Link>
          <nav className="flex items-center gap-4">
            {LINKS.map((link) => {
              const active =
                link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "text-[13px] transition-colors",
                    active ? "text-ink" : "text-ink-muted hover:text-ink-secondary",
                  ].join(" ")}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* The token reference is a tool for building this, not a place a
              rider would ever want to go. Kept reachable at /design during
              development, out of the way in production. */}
          {process.env.NODE_ENV !== "production" ? (
            <Link
              href="/design"
              className="text-[13px] text-ink-muted transition-colors hover:text-ink-secondary"
            >
              Tokens
            </Link>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
