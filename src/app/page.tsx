import Link from "next/link";
import { ImportSurface } from "@/components/ride/import-surface";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <header className="flex items-center justify-between gap-4 pb-2">
        <span className="text-[15px] font-medium tracking-tight text-ink">Ryda</span>
        <div className="flex items-center gap-3">
          <Link
            href="/ride"
            className="text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            Demo ride
          </Link>
          <Link
            href="/design"
            className="text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            Tokens
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <ImportSurface />
    </main>
  );
}
