import { ResponsiveBullet } from "@nivo/bullet";
import { useMemo } from "react";
import type { Tier, TierKey } from "../api";
import { lapTime } from "../lib/format";
import { useNivoTheme, usePalette, useTierColors } from "../lib/mode";

const DOMAIN_MIN_PCT = 99;
const DOMAIN_MAX_PCT = 108;
const BAND_ALPHA = "38";

export type LadderMark = { pct: number; label: string };

export function tierOf(tiers: Tier[], key: TierKey | null) {
  return tiers.find((t) => t.key === key);
}

export function TierLadder({
  tiers,
  alienMs,
  measure,
  marker,
  height = 54,
}: {
  tiers: Tier[];
  alienMs: number;
  measure: LadderMark & { tier: TierKey };
  marker?: LadderMark;
  height?: number;
}) {
  const palette = usePalette();
  const colors = useTierColors();
  const theme = useNivoTheme();

  const { min, max, ranges } = useMemo(() => {
    const values = [measure.pct, marker?.pct ?? measure.pct];
    const lo = Math.floor(Math.min(DOMAIN_MIN_PCT, ...values.map((v) => v - 0.4)));
    const hi = Math.ceil(Math.max(DOMAIN_MAX_PCT, ...values.map((v) => v + 0.4)));
    return { min: lo, max: hi, ranges: tiers.flatMap((t) => (t.max_pct != null && t.max_pct < hi ? [t.max_pct] : [])) };
  }, [tiers, measure.pct, marker?.pct]);

  const bandFor = (v1: number) => tiers.find((t) => t.max_pct === v1) ?? tiers[tiers.length - 1];

  return (
    <div style={{ height }}>
      <ResponsiveBullet
        data={[{ id: "pace", title: " ", ranges, measures: [measure.pct], markers: marker ? [marker.pct] : [] }]}
        minValue={min}
        maxValue={max}
        margin={{ top: 2, right: 14, bottom: 22, left: 8 }}
        theme={{ ...theme, axis: { ...theme.axis, domain: { line: { strokeWidth: 0 } } } }}
        rangeColors={tiers.map((t) => colors[t.key] + BAND_ALPHA)}
        measureColors={[colors[measure.tier]]}
        markerColors={[palette.bone]}
        measureSize={0.34}
        markerSize={0.92}
        titleOffsetX={0}
        animate={false}
        tooltip={({ v0, v1 }) => {
          const isMeasure = v1 === measure.pct && v0 === min;
          const band = v1 != null ? bandFor(v1) : null;
          return (
            <div className="rounded-md border border-line-strong bg-ink-850 px-3 py-2 text-[12px] shadow-lg">
              {isMeasure ? (
                <>
                  <div className="label mb-1">{measure.label}</div>
                  <div className="num text-bone">{measure.pct.toFixed(2)}%</div>
                </>
              ) : (
                band && (
                  <>
                    <div className="label mb-1" style={{ color: colors[band.key] }}>{band.label}</div>
                    <div className="num text-bone">
                      {band.max_pct == null ? `slower than ${lapTime((alienMs * v0) / 100, 2)}` : `under ${lapTime((alienMs * band.max_pct) / 100, 2)}`}
                    </div>
                  </>
                )
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
