import { Line, type LineCustomSvgLayerProps, type LineSvgLayer } from "@nivo/line";
import { memo, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Corner } from "../api";
import { nearestIndex, useStore, type Store } from "../lib/cursor";
import { useElementWidth } from "../lib/useElementWidth";
import { nivoTheme, palette } from "../theme";

export type ChartSeries = { id: string; label: string; color: string; values: number[] };
type NivoSeries = { id: string; color: string; data: { x: number; y: number }[] };
type LayerProps = LineCustomSvgLayerProps<NivoSeries>;

const MARGIN_LEFT = 52;
const MARGIN_RIGHT = 30;
const MARGIN_TOP = 6;
const AXIS_BAND = 26;

function sliceRange(s: number[], [d0, d1]: [number, number]): [number, number] {
  return [Math.max(0, nearestIndex(s, d0) - 1), Math.min(s.length - 1, nearestIndex(s, d1) + 1)];
}

function CornerBands({ corners, showLabels }: { corners: Corner[]; showLabels: boolean }) {
  return function Bands({ xScale, innerHeight, innerWidth }: LayerProps) {
    return (
      <g>
        {corners.map((c) => {
          const x0 = Math.max(0, xScale(c.s_start));
          const x1 = Math.min(innerWidth, xScale(c.s_end));
          if (x1 <= 0 || x0 >= innerWidth) return null;
          const apex = xScale(c.s_apex);
          return (
            <g key={c.index}>
              {c.index % 2 === 1 && <rect x={x0} y={0} width={x1 - x0} height={innerHeight} fill="#ffffff" opacity={0.022} />}
              {showLabels && apex > 8 && apex < innerWidth - 8 && (
                <text x={apex} y={11} textAnchor="middle" fontSize={10} fontFamily="Barlow Condensed" fontWeight={700} fill={palette.mute}>
                  {c.name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };
}

function DeltaArea({ series, yScale, innerWidth, innerHeight }: LayerProps) {
  const points = series[0]?.data.map((d) => d.position) ?? [];
  if (points.length < 2) return null;
  const zero = Math.min(innerHeight, Math.max(0, yScale(0)));
  const area = `M${points[0].x},${zero}` + points.map((p) => `L${p.x},${p.y}`).join("") + `L${points[points.length - 1].x},${zero}Z`;
  return (
    <g>
      <defs>
        <clipPath id="delta-above">
          <rect x={0} y={0} width={innerWidth} height={zero} />
        </clipPath>
        <clipPath id="delta-below">
          <rect x={0} y={zero} width={innerWidth} height={innerHeight - zero} />
        </clipPath>
      </defs>
      <path d={area} fill={palette.loss} opacity={0.28} clipPath="url(#delta-above)" />
      <path d={area} fill={palette.gain} opacity={0.28} clipPath="url(#delta-below)" />
      <line x1={0} x2={innerWidth} y1={zero} y2={zero} stroke={palette.lineStrong} />
    </g>
  );
}

const Plot = memo(function Plot({
  data,
  width,
  height,
  domain,
  yRange,
  curve,
  showXAxis,
  corners,
  showCornerLabels,
  delta,
  format,
}: {
  data: NivoSeries[];
  width: number;
  height: number;
  domain: [number, number];
  yRange: [number, number] | null;
  curve: "linear" | "stepAfter";
  showXAxis: boolean;
  corners: Corner[];
  showCornerLabels: boolean;
  delta: boolean;
  format: (v: number) => string;
}) {
  const bands = useMemo(() => CornerBands({ corners, showLabels: showCornerLabels }), [corners, showCornerLabels]);
  const layers: LineSvgLayer<NivoSeries>[] = delta
    ? ["grid", bands, DeltaArea, "lines", "axes"]
    : ["grid", bands, "lines", "axes"];
  return (
    <Line<NivoSeries>
      data={data}
      width={width}
      height={height}
      margin={{ top: MARGIN_TOP, right: MARGIN_RIGHT, bottom: showXAxis ? AXIS_BAND : 4, left: MARGIN_LEFT }}
      theme={nivoTheme}
      xScale={{ type: "linear", min: domain[0], max: domain[1], nice: false }}
      yScale={yRange ? { type: "linear", min: yRange[0], max: yRange[1] } : { type: "linear", min: "auto", max: "auto" }}
      curve={curve}
      colors={(serie) => serie.color}
      lineWidth={1.6}
      enablePoints={false}
      enableGridX={false}
      gridYValues={4}
      axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4, format }}
      axisBottom={showXAxis ? { tickSize: 4, tickPadding: 6, tickValues: 8, format: (v) => `${(Number(v) / 1000).toFixed(1)} km` } : null}
      isInteractive={false}
      animate={false}
      layers={layers}
    />
  );
});

function CursorOverlay({
  s,
  domain,
  innerWidth,
  innerHeight,
  cursor,
  onZoom,
  onReset,
}: {
  s: number[];
  domain: [number, number];
  innerWidth: number;
  innerHeight: number;
  cursor: Store<number | null>;
  onZoom: (range: [number, number]) => void;
  onReset: () => void;
}) {
  const value = useStore(cursor);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const toS = (px: number) => domain[0] + (Math.min(Math.max(px, 0), innerWidth) / innerWidth) * (domain[1] - domain[0]);
  const toPx = (sv: number) => ((sv - domain[0]) / (domain[1] - domain[0])) * innerWidth;
  const local = (e: PointerEvent<HTMLDivElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (s[1] - s[0]) * (e.shiftKey ? 20 : 2);
    const current = value ?? (domain[0] + domain[1]) / 2;
    cursor.set(Math.min(domain[1], Math.max(domain[0], current + (e.key === "ArrowLeft" ? -step : step))));
  };

  return (
    <div
      tabIndex={0}
      aria-label="Chart area. Arrow keys move the cursor, drag to zoom, double click to reset."
      className="absolute cursor-crosshair outline-none focus-visible:ring-1 focus-visible:ring-signal/60"
      style={{ left: MARGIN_LEFT, top: MARGIN_TOP, width: innerWidth, height: innerHeight }}
      onPointerMove={(e) => {
        const x = local(e);
        cursor.set(toS(x));
        if (drag) setDrag([drag[0], x]);
      }}
      onPointerLeave={() => cursor.set(null)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const x = local(e);
        setDrag([x, x]);
      }}
      onPointerUp={() => {
        if (drag && Math.abs(drag[1] - drag[0]) > 8) {
          const [a, b] = [toS(Math.min(...drag)), toS(Math.max(...drag))];
          onZoom([a, b]);
        }
        setDrag(null);
      }}
      onDoubleClick={onReset}
      onKeyDown={onKey}
    >
      {drag && Math.abs(drag[1] - drag[0]) > 2 && (
        <div
          className="absolute inset-y-0 border-x border-signal/60 bg-signal/10"
          style={{ left: Math.min(...drag), width: Math.abs(drag[1] - drag[0]) }}
        />
      )}
      {value != null && value >= domain[0] && value <= domain[1] && (
        <div className="pointer-events-none absolute inset-y-0 w-px bg-bone/50" style={{ left: toPx(value) }} />
      )}
    </div>
  );
}

function Readout({ s, series, cursor, format }: { s: number[]; series: ChartSeries[]; cursor: Store<number | null>; format: (v: number) => string }) {
  const value = useStore(cursor);
  const i = value == null ? null : nearestIndex(s, value);
  return (
    <div className="flex items-center gap-4 text-[12px]">
      {series.map((serie) => (
        <span key={serie.id} className="inline-flex items-center gap-2 text-bone-dim">
          <span className="h-[3px] w-3 rounded-full" style={{ background: serie.color }} />
          <span className="hidden sm:inline">{serie.label}</span>
          <span className="num min-w-[4.5ch] text-right text-bone">{i == null ? "-" : format(serie.values[i])}</span>
        </span>
      ))}
    </div>
  );
}

export function TraceChart({
  title,
  s,
  series,
  domain,
  height,
  cursor,
  corners,
  onZoom,
  onReset,
  format,
  yRange = null,
  curve = "linear",
  showXAxis = false,
  showCornerLabels = false,
  delta = false,
}: {
  title: string;
  s: number[];
  series: ChartSeries[];
  domain: [number, number];
  height: number;
  cursor: Store<number | null>;
  corners: Corner[];
  onZoom: (range: [number, number]) => void;
  onReset: () => void;
  format: (v: number) => string;
  yRange?: [number, number] | null;
  curve?: "linear" | "stepAfter";
  showXAxis?: boolean;
  showCornerLabels?: boolean;
  delta?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotHeight = height + (showXAxis ? AXIS_BAND : 0);
  const data = useMemo(() => {
    const [i0, i1] = sliceRange(s, domain);
    return series.map((serie) => ({
      id: serie.id,
      color: serie.color,
      data: s.slice(i0, i1 + 1).map((x, k) => ({ x, y: serie.values[i0 + k] })),
    }));
  }, [s, series, domain]);
  const innerWidth = Math.max(0, width - MARGIN_LEFT - MARGIN_RIGHT);
  const innerHeight = height - MARGIN_TOP - 4;

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="label !text-bone-dim">{title}</span>
        <Readout s={s} series={series} cursor={cursor} format={format} />
      </div>
      <div ref={ref} className="relative" style={{ height: plotHeight }}>
        {width > 0 && (
          <>
            <Plot
              data={data}
              width={width}
              height={plotHeight}
              domain={domain}
              yRange={yRange}
              curve={curve}
              showXAxis={showXAxis}
              corners={corners}
              showCornerLabels={showCornerLabels}
              delta={delta}
              format={format}
            />
            <CursorOverlay
              s={s}
              domain={domain}
              innerWidth={innerWidth}
              innerHeight={innerHeight}
              cursor={cursor}
              onZoom={onZoom}
              onReset={onReset}
            />
          </>
        )}
      </div>
    </div>
  );
}
