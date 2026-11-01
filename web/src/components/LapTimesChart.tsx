import { ResponsiveLine, type LineCustomSvgLayerProps } from "@nivo/line";
import type { Lap } from "../api";
import { lapTime } from "../lib/format";
import { useNivoTheme, usePalette } from "../lib/mode";

type Datum = { x: number; y: number; valid: boolean; best: boolean };
type Serie = { id: string; data: Datum[] };

function Markers({ series, xScale, yScale }: LineCustomSvgLayerProps<Serie>) {
  const palette = usePalette();
  return (
    <g>
      {series[0].data.map(({ data }) => {
        const cx = xScale(data.x);
        const cy = yScale(data.y);
        if (data.best)
          return (
            <g key={data.x}>
              <circle cx={cx} cy={cy} r={6} fill={palette.best} stroke={palette.ink900} strokeWidth={2} />
              <text x={cx} y={cy - 12} textAnchor="middle" fontSize={11} fontFamily="JetBrains Mono" fill={palette.best}>
                {lapTime(data.y * 1000)}
              </text>
            </g>
          );
        return data.valid ? (
          <circle key={data.x} cx={cx} cy={cy} r={4} fill={palette.bone} stroke={palette.ink900} strokeWidth={2} />
        ) : (
          <circle key={data.x} cx={cx} cy={cy} r={3.5} fill={palette.ink900} stroke={palette.loss} strokeWidth={1.5} />
        );
      })}
    </g>
  );
}

function IdealLine({ idealMs, color }: { idealMs: number | null; color: string }) {
  return function Ideal({ yScale, innerWidth }: LineCustomSvgLayerProps<Serie>) {
    if (idealMs == null) return null;
    const y = yScale(idealMs / 1000);
    return (
      <g>
        <line x1={0} x2={innerWidth} y1={y} y2={y} stroke={color} strokeOpacity={0.6} strokeDasharray="2 4" />
        <text x={innerWidth} y={y + 13} textAnchor="end" fontSize={10} fontFamily="JetBrains Mono" fill={color}>
          ideal {lapTime(idealMs)}
        </text>
      </g>
    );
  };
}

export function LapTimesChart({ laps, bestMs, idealMs }: { laps: Lap[]; bestMs: number | null; idealMs: number | null }) {
  const palette = usePalette();
  const nivoTheme = useNivoTheme();
  const data: Datum[] = laps
    .filter((l) => l.lap_time_ms && !l.is_out_lap && !l.is_in_lap)
    .map((l) => ({ x: l.lap_number, y: l.lap_time_ms! / 1000, valid: !!l.valid, best: l.lap_time_ms === bestMs }));

  if (data.length < 2)
    return <div className="flex h-full items-center justify-center text-[14px] text-mute">Not enough timed laps to plot.</div>;

  const ys = data.map((d) => d.y).concat(idealMs ? [idealMs / 1000] : []);
  const pad = Math.max(0.3, (Math.max(...ys) - Math.min(...ys)) * 0.12);

  return (
    <ResponsiveLine<Serie>
      data={[{ id: "Lap time", data }]}
      margin={{ top: 24, right: 20, bottom: 32, left: 64 }}
      theme={nivoTheme}
      xScale={{ type: "linear", min: data[0].x - 0.5, max: data[data.length - 1].x + 0.5 }}
      yScale={{ type: "linear", min: Math.min(...ys) - pad, max: Math.max(...ys) + pad }}
      colors={[palette.lineStrong]}
      lineWidth={1.5}
      enablePoints={false}
      enableGridX={false}
      gridYValues={5}
      axisLeft={{ tickSize: 0, tickPadding: 10, tickValues: 5, format: (v) => lapTime(Number(v) * 1000).slice(0, -2) }}
      axisBottom={{
        tickSize: 0,
        tickPadding: 10,
        tickValues: data.map((d) => d.x),
        legend: "Lap",
        legendOffset: 28,
        legendPosition: "end",
      }}
      layers={["grid", "axes", IdealLine({ idealMs, color: palette.signal }), "lines", Markers, "mesh"]}
      useMesh
      animate={false}
      tooltip={({ point }) => (
        <div className="rounded-md border border-line-strong bg-ink-850 px-3 py-2 text-[12px] shadow-lg">
          <div className="label">Lap {point.data.x}</div>
          <div className="num mt-0.5 text-[14px] text-bone">{lapTime(point.data.y * 1000)}</div>
          {!point.data.valid && <div className="text-loss">Invalidated</div>}
        </div>
      )}
    />
  );
}
