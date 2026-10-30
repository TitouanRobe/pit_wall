import { ResponsiveLine } from "@nivo/line";
import { useMemo } from "react";
import { nivoTheme, palette } from "../theme";

export type SessionPoint = { id: string; tick: string; title: string };
export type SessionSeries = { id: string; label: string; color: string; values: number[] };

type Datum = { x: string; y: number };
type Serie = { id: string; color: string; data: Datum[] };

const MAX_TICKS = 10;

export function SessionLineChart({
  points,
  series,
  format,
  axisFormat,
  target,
}: {
  points: SessionPoint[];
  series: SessionSeries[];
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  target?: { value: number; label: string };
}) {
  const { data, ticks, min, max, byId, labels } = useMemo(() => {
    const values = series.flatMap((s) => s.values).concat(target ? [target.value] : []);
    const pad = Math.max((Math.max(...values) - Math.min(...values)) * 0.18, 1e-6);
    const step = Math.ceil(points.length / MAX_TICKS);
    return {
      data: series.map<Serie>((s) => ({ id: s.id, color: s.color, data: points.map((p, i) => ({ x: p.id, y: s.values[i] })) })),
      ticks: points.filter((_, i) => i % step === 0).map((p) => p.id),
      min: Math.min(...values) - pad,
      max: Math.max(...values) + pad,
      byId: new Map(points.map((p) => [p.id, p])),
      labels: new Map(series.map((s) => [s.id, s])),
    };
  }, [points, series, target]);

  return (
    <ResponsiveLine<Serie>
      data={data}
      margin={{ top: 16, right: 24, bottom: 34, left: 64 }}
      theme={nivoTheme}
      xScale={{ type: "point" }}
      yScale={{ type: "linear", min, max }}
      colors={(serie) => serie.color}
      lineWidth={1.6}
      pointSize={8}
      pointColor={{ from: "series.color" }}
      pointBorderWidth={2}
      pointBorderColor={palette.ink900}
      enableGridX={false}
      gridYValues={4}
      axisLeft={{ tickSize: 0, tickPadding: 10, tickValues: 4, format: (v) => axisFormat(Number(v)) }}
      axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: ticks, format: (v) => byId.get(String(v))?.tick ?? "" }}
      markers={
        target
          ? [
              {
                axis: "y",
                value: target.value,
                lineStyle: { stroke: palette.signal, strokeWidth: 1, strokeOpacity: 0.7 },
                legend: target.label,
                legendPosition: "bottom-left",
                textStyle: { fill: palette.signal, fontSize: 10, fontFamily: "JetBrains Mono" },
              },
            ]
          : undefined
      }
      enableSlices="x"
      animate={false}
      sliceTooltip={({ slice }) => (
        <div className="rounded-md border border-line-strong bg-ink-850 px-3 py-2 text-[12px] shadow-lg">
          <div className="label mb-1.5">{byId.get(String(slice.points[0].data.x))?.title}</div>
          {slice.points.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-5">
              <span className="inline-flex items-center gap-2 text-bone-dim">
                <span className="h-[3px] w-3 rounded-full" style={{ background: p.seriesColor }} />
                {labels.get(String(p.seriesId))?.label}
              </span>
              <span className="num text-bone">{format(Number(p.data.y))}</span>
            </div>
          ))}
        </div>
      )}
    />
  );
}
