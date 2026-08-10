import type { ConfidenceLevel, PowerConfidence } from "@/lib/analysis/types";

/**
 * Honesty about the power estimate, shown as a first-class element rather than
 * buried in a tooltip.
 *
 * Status colour is always paired with a glyph and a label — colour never
 * carries the meaning alone.
 */
const PRESENTATION: Record<
  ConfidenceLevel,
  { token: string; glyph: string; title: string }
> = {
  high: { token: "--status-good", glyph: "●", title: "High confidence" },
  moderate: { token: "--status-warning", glyph: "◐", title: "Moderate confidence" },
  low: { token: "--status-serious", glyph: "◑", title: "Low confidence" },
  unusable: { token: "--status-critical", glyph: "○", title: "Not trustworthy" },
};

export function ConfidenceChip({ confidence }: { confidence: PowerConfidence }) {
  const p = PRESENTATION[confidence.level];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 px-4 py-3">
      <span aria-hidden className="mt-0.5 text-[13px]" style={{ color: `var(${p.token})` }}>
        {p.glyph}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">
          {p.title}
          <span className="ml-2 font-normal text-ink-muted">
            — power is estimated, not measured
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
          {confidence.summary} Expect roughly ±30–40&nbsp;W even in good conditions;
          wind and drafting cannot be recovered from a GPS trace.
        </p>
      </div>
    </div>
  );
}
