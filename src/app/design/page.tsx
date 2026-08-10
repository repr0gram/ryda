import { ThemeToggle } from "@/components/theme-toggle";

const CHANNELS = [
  { name: "Power", token: "--ch-power", note: "estimated" },
  { name: "Heart rate", token: "--ch-hr", note: "measured" },
  { name: "Cadence", token: "--ch-cadence", note: "measured" },
  { name: "Speed", token: "--ch-speed", note: "measured" },
  { name: "Temperature", token: "--ch-temp", note: "measured" },
  { name: "W′ balance", token: "--ch-wbal", note: "derived" },
];

const RIDES = [1, 2, 3, 4, 5, 6];

const STATUS = [
  { name: "High confidence", token: "--status-good", glyph: "●" },
  { name: "Some wind/draft", token: "--status-warning", glyph: "◐" },
  { name: "Low confidence", token: "--status-serious", glyph: "◑" },
  { name: "Not trustworthy", token: "--status-critical", glyph: "○" },
];

const SURFACES = [
  { name: "page", token: "--surface-page" },
  { name: "surface-1", token: "--surface-1" },
  { name: "surface-2", token: "--surface-2" },
  { name: "surface-3", token: "--surface-3" },
];

const INK = [
  { name: "primary", token: "--ink-primary" },
  { name: "secondary", token: "--ink-secondary" },
  { name: "muted", token: "--ink-muted" },
];

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-sm font-medium tracking-tight text-ink">{title}</h2>
      {caption ? (
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-muted">
          {caption}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A colour chip that reports the resolved value, so both themes are verifiable. */
function Swatch({ token, label, sub }: { token: string; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="h-8 w-8 shrink-0 rounded-md ring-1 ring-[var(--line-hairline)]"
        style={{ background: `var(${token})` }}
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-ink">{label}</span>
        <span className="block truncate font-mono text-[11px] text-ink-muted">
          {sub ?? token}
        </span>
      </span>
    </div>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-14">
      <header className="flex items-start justify-between gap-6 pb-10">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-ink">
            Ryda design tokens
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
            Chrome is monochrome plus one brand violet. Saturated colour is
            reserved for data — so a chart is the only place hue carries meaning.
            Every palette below was checked with the CVD validator against these
            exact surfaces, not chosen by eye.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="space-y-10">
        <Section
          title="Surfaces"
          caption="A four-step ramp. Never pure black or pure white — both crush the shadow detail that separates a card from the page."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SURFACES.map((s) => (
              <Swatch key={s.token} token={s.token} label={s.name} />
            ))}
          </div>
        </Section>

        <Section title="Ink">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {INK.map((s) => (
              <Swatch key={s.token} token={s.token} label={s.name} />
            ))}
          </div>
          <div className="mt-6 space-y-1.5 rounded-lg border border-hairline bg-surface-1 p-5">
            <p className="text-[15px] text-ink">
              Primary ink carries values and headings.
            </p>
            <p className="text-[15px] text-ink-secondary">
              Secondary ink carries supporting prose like this.
            </p>
            <p className="text-[13px] text-ink-muted">
              Muted ink is for axis ticks, units, and captions only.
            </p>
          </div>
        </Section>

        <Section
          title="Data channels"
          caption="Semantic and global: heart rate is this red in every chart, on the map trace, and in every legend. Power and heart rate co-plot most often, so they take the two most-separated hues. Worst-case CVD separation is ΔE 10.3 (dark) — the floor band — which is legal because every channel row ships a direct label and a live value, so identity never rests on colour alone."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNELS.map((c) => (
              <Swatch
                key={c.token}
                token={c.token}
                label={c.name}
                sub={`${c.token} · ${c.note}`}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
            <span
              aria-hidden
              className="h-8 w-8 shrink-0 rounded-md ring-1 ring-[var(--line-hairline)]"
              style={{ background: "var(--ch-elevation)" }}
            />
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              <span className="text-ink">Elevation is chrome, not a channel.</span>{" "}
              It is context behind the data, so it renders as a recessive ghost
              fill and never spends one of the identity hues.
            </p>
          </div>
        </Section>

        <Section
          title="Ride identity — Compare mode"
          caption="Compare plots one channel across several rides, so these never share a chart with the channel hues. Assigned in fixed slot order and never cycled; a seventh ride folds into “others” rather than inventing a hue."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {RIDES.map((n) => (
              <Swatch key={n} token={`--ride-${n}`} label={`Ride ${n}`} />
            ))}
          </div>
        </Section>

        <Section
          title="Power confidence"
          caption="Status colours are reserved and never reused as a series. Wind and drafting are unknowable from a GPS trace, so every estimated ride carries a confidence chip — always an icon plus a label, never colour alone."
        >
          <div className="flex flex-wrap gap-2">
            {STATUS.map((s) => (
              <span
                key={s.token}
                className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 py-1.5 pl-2.5 pr-3.5 text-[13px] text-ink-secondary"
              >
                <span aria-hidden style={{ color: `var(${s.token})` }}>
                  {s.glyph}
                </span>
                {s.name}
              </span>
            ))}
          </div>
        </Section>

        <Section
          title="Numerals"
          caption="Columns use tabular figures so digits align vertically. Hero figures switch to proportional figures, which are better spaced at large sizes."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-hairline bg-surface-1 p-5">
              <div className="flex items-baseline gap-1.5">
                <span className="figure-hero text-5xl text-ink">184</span>
                <span className="text-sm text-ink-muted">W</span>
              </div>
              <p className="mt-2 text-[13px] text-ink-muted">
                Hero figure — proportional
              </p>
            </div>
            <div className="rounded-lg border border-hairline bg-surface-1 p-5">
              <table className="w-full text-[13px]">
                <tbody className="text-ink">
                  <tr>
                    <td className="py-0.5 text-ink-secondary">Distance</td>
                    <td className="py-0.5 text-right">68.4 km</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 text-ink-secondary">Climbing</td>
                    <td className="py-0.5 text-right">1,204 m</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 text-ink-secondary">Moving</td>
                    <td className="py-0.5 text-right">2:41:07</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[13px] text-ink-muted">Column — tabular</p>
            </div>
          </div>
        </Section>

        <Section
          title="Brand"
          caption="Violet is deliberately excluded from the channel palette so it can mean “Ryda the app” — active nav, primary action, focus ring — and never be mistaken for data."
        >
          <div className="flex flex-wrap items-center gap-4">
            <Swatch token="--brand" label="brand" />
            <button className="rounded-md bg-[var(--brand)] px-3.5 py-2 text-[13px] font-medium text-[var(--brand-contrast)]">
              Import rides
            </button>
            <button className="rounded-md border border-hairline bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink">
              Secondary
            </button>
          </div>
        </Section>
      </div>
    </main>
  );
}
