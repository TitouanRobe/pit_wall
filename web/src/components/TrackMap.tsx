import { useMemo, useRef, type PointerEvent } from "react";
import type { Corner, Trace, TrackMap as TrackMapData } from "../api";
import { nearestIndex, useStore, type Store } from "../lib/cursor";
import { palette } from "../theme";

type Geometry = { points: [number, number][]; viewBox: string; scale: number };

function geometry(x: number[], z: number[], pad = 0.06): Geometry {
  const points = x.map((xi, i) => [xi, -z[i]] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY);
  const p = span * pad;
  return {
    points,
    viewBox: `${minX - p} ${minY - p} ${maxX - minX + 2 * p} ${maxY - minY + 2 * p}`,
    scale: span / 400,
  };
}

function polyline(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
}

export function TrackOutline({ map, className }: { map: TrackMapData; className?: string }) {
  const geo = useMemo(() => geometry(map.x, map.z, 0.08), [map]);
  return (
    <svg viewBox={geo.viewBox} className={className} aria-hidden>
      <path d={polyline(geo.points)} fill="none" stroke={palette.lineStrong} strokeWidth={geo.scale * 9} strokeLinejoin="round" />
      <path d={polyline(geo.points)} fill="none" stroke={palette.boneDim} strokeWidth={geo.scale * 3} strokeLinejoin="round" />
      <circle cx={geo.points[0][0]} cy={geo.points[0][1]} r={geo.scale * 7} fill={palette.signal} />
    </svg>
  );
}

const RATE_WINDOW_M = 40;
const RATE_THRESHOLD = 0.0004;

type Run = { color: string; points: [number, number][] };

function deltaRuns(geo: Geometry, s: number[], delta: number[]): Run[] {
  const step = s[1] - s[0];
  const half = Math.max(1, Math.round(RATE_WINDOW_M / step / 2));
  const colorAt = (i: number) => {
    const a = Math.max(0, i - half);
    const b = Math.min(delta.length - 1, i + half);
    const rate = (delta[b] - delta[a]) / (s[b] - s[a]);
    if (rate > RATE_THRESHOLD) return palette.loss;
    if (rate < -RATE_THRESHOLD) return palette.gain;
    return palette.boneDim;
  };
  const runs: Run[] = [];
  for (let i = 0; i < Math.min(geo.points.length, delta.length) - 1; i++) {
    const color = colorAt(i);
    const last = runs[runs.length - 1];
    if (last && last.color === color) last.points.push(geo.points[i + 1]);
    else runs.push({ color, points: [geo.points[i], geo.points[i + 1]] });
  }
  return runs;
}

function CursorDots({ cursor, geo, refTrace, cmpTrace }: { cursor: Store<number | null>; geo: Geometry; refTrace: Trace; cmpTrace: Trace }) {
  const s = useStore(cursor);
  if (s == null) return null;
  const dot = (trace: Trace, color: string) => {
    const i = nearestIndex(trace.s, s);
    return (
      <circle cx={trace.pos_x[i]} cy={-trace.pos_z[i]} r={geo.scale * 7} fill={color} stroke={palette.ink900} strokeWidth={geo.scale * 2.5} />
    );
  };
  return (
    <g>
      {dot(refTrace, palette.ref)}
      {dot(cmpTrace, palette.cmp)}
    </g>
  );
}

export function DeltaMap({
  map,
  delta,
  refTrace,
  cmpTrace,
  cursor,
  domain,
  onCornerClick,
}: {
  map: TrackMapData;
  delta: number[];
  refTrace: Trace;
  cmpTrace: Trace;
  cursor: Store<number | null>;
  domain: [number, number];
  onCornerClick: (corner: Corner) => void;
}) {
  const geo = useMemo(() => geometry(map.x, map.z), [map]);
  const runs = useMemo(() => deltaRuns(geo, map.s, delta), [geo, map.s, delta]);
  const svgRef = useRef<SVGSVGElement>(null);
  const full = domain[0] <= map.s[0] && domain[1] >= map.s[map.s.length - 1];
  const zoomed = useMemo(
    () => geo.points.filter((_, i) => map.s[i] >= domain[0] && map.s[i] <= domain[1]),
    [geo, map.s, domain],
  );

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = 0;
    let bestD = Infinity;
    geo.points.forEach(([x, y], i) => {
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    });
    cursor.set(Math.sqrt(bestD) < geo.scale * 40 ? map.s[best] : null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={geo.viewBox}
      className="h-full w-full touch-none select-none"
      onPointerMove={onMove}
      onPointerLeave={() => cursor.set(null)}
      role="img"
      aria-label="Track map coloured by where the compared lap gains or loses time"
    >
      <path d={polyline(geo.points)} fill="none" stroke={palette.ink800} strokeWidth={geo.scale * 16} strokeLinejoin="round" />
      {!full && zoomed.length > 1 && (
        <path
          d={zoomed.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")}
          fill="none"
          stroke={palette.bone}
          strokeOpacity={0.1}
          strokeWidth={geo.scale * 26}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {runs.map((run, i) => (
        <path
          key={i}
          d={run.points.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}
          fill="none"
          stroke={run.color}
          strokeWidth={geo.scale * (run.color === palette.boneDim ? 3 : 5)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <g>
        <rect
          x={geo.points[0][0] - geo.scale * 3}
          y={geo.points[0][1] - geo.scale * 12}
          width={geo.scale * 6}
          height={geo.scale * 24}
          fill={palette.bone}
        />
      </g>
      {map.corners.map((corner) => {
        const i = nearestIndex(map.s, corner.s_apex);
        const [x, y] = geo.points[i];
        const r = geo.scale * 13;
        return (
          <g key={corner.index} className="cursor-pointer" onClick={() => onCornerClick(corner)}>
            <circle cx={x} cy={y} r={r} fill={palette.ink900} stroke={palette.lineStrong} strokeWidth={geo.scale * 1.5} />
            <text
              x={x}
              y={y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={geo.scale * 11}
              fontFamily="Barlow Condensed"
              fontWeight={700}
              fill={palette.bone}
            >
              {corner.name}
            </text>
          </g>
        );
      })}
      <CursorDots cursor={cursor} geo={geo} refTrace={refTrace} cmpTrace={cmpTrace} />
    </svg>
  );
}
