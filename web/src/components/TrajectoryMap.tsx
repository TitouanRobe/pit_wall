import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Trace } from "../api";
import { nearestIndex, useStore, type Store } from "../lib/cursor";
import { usePalette } from "../lib/mode";

const MIN_SPAN_M = 60;
const PAD = 0.18;
const ASPECT = 2;
const TRACK_WIDTH_M = 12;
const MIN_SIZE = 25;
const WHEEL_STEP = 1.0015;

type View = { cx: number; cy: number; size: number };

function path(trace: Trace, from = 0, to = trace.s.length - 1): string {
  let d = "";
  for (let i = from; i <= to; i++) d += `${i === from ? "M" : "L"}${trace.pos_x[i].toFixed(2)} ${(-trace.pos_z[i]).toFixed(2)}`;
  return d;
}

function fit(traces: Trace[], domain: [number, number] | null): View {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of traces) {
    const a = domain ? nearestIndex(t.s, domain[0]) : 0;
    const b = domain ? nearestIndex(t.s, domain[1]) : t.s.length - 1;
    for (let i = a; i <= b; i++) {
      const x = t.pos_x[i];
      const y = -t.pos_z[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const size = Math.max((maxY - minY) * (1 + 2 * PAD), ((maxX - minX) * (1 + 2 * PAD)) / ASPECT, MIN_SPAN_M);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size };
}

function Dots({ cursor, unit, refTrace, cmpTrace }: { cursor: Store<number | null>; unit: number; refTrace: Trace; cmpTrace: Trace }) {
  const palette = usePalette();
  const s = useStore(cursor);
  if (s == null) return null;
  const dot = (trace: Trace, color: string) => {
    const i = nearestIndex(trace.s, s);
    return <circle cx={trace.pos_x[i]} cy={-trace.pos_z[i]} r={unit * 6} fill={color} stroke={palette.ink900} strokeWidth={unit * 2} />;
  };
  return (
    <g>
      {dot(refTrace, palette.ref)}
      {dot(cmpTrace, palette.cmp)}
    </g>
  );
}

export function TrajectoryMap({
  refTrace,
  cmpTrace,
  cursor,
  domain,
}: {
  refTrace: Trace;
  cmpTrace: Trace;
  cursor: Store<number | null>;
  domain: [number, number];
}) {
  const palette = usePalette();
  const length = refTrace.s[refTrace.s.length - 1];
  const full = domain[0] <= refTrace.s[0] && domain[1] >= length;
  const [view, setView] = useState<View>(() => fit([refTrace, cmpTrace], full ? null : domain));
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setView(fit([refTrace, cmpTrace], full ? null : domain));
  }, [refTrace, cmpTrace, domain, full]);

  const width = view.size * ASPECT;
  const unit = view.size / 400;
  const box = { x: view.cx - width / 2, y: view.cy - view.size / 2 };

  const outline = useMemo(() => path(refTrace), [refTrace]);
  const refPath = useMemo(() => path(refTrace), [refTrace]);
  const cmpPath = useMemo(() => path(cmpTrace), [cmpTrace]);
  const highlight = useMemo(
    () => (full ? null : path(refTrace, nearestIndex(refTrace.s, domain[0]), nearestIndex(refTrace.s, domain[1]))),
    [refTrace, domain, full],
  );

  const zoomAt = (factor: number, anchor?: { x: number; y: number }) =>
    setView((v) => {
      const size = Math.min(fit([refTrace, cmpTrace], null).size * 1.5, Math.max(MIN_SIZE, v.size * factor));
      const k = size / v.size;
      const a = anchor ?? { x: v.cx, y: v.cy };
      return { size, cx: a.x + (v.cx - a.x) * k, cy: a.y + (v.cy - a.y) * k };
    });

  const toSvg = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  };

  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      if (p) zoomRef.current(Math.pow(WHEEL_STEP, e.deltaY), { x: p.x, y: p.y });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const dx = (e.clientX - drag.current.x) / ctm.a;
    const dy = (e.clientY - drag.current.y) / ctm.d;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, cx: v.cx - dx, cy: v.cy - dy }));
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  const road = Math.max(TRACK_WIDTH_M, unit * 6);
  const line = unit * 2;
  const buttons = [
    { label: "Zoom in", glyph: "+", run: () => zoomAt(0.6) },
    { label: "Zoom out", glyph: "−", run: () => zoomAt(1 / 0.6) },
    { label: "Fit", glyph: "⤢", run: () => setView(fit([refTrace, cmpTrace], full ? null : domain)) },
  ];

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${width} ${view.size}`}
        className={`h-full w-full touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label="Racing lines of the two compared laps overlaid on the circuit. Drag to pan, scroll to zoom."
      >
        <path d={outline} fill="none" stroke={palette.lineStrong} strokeWidth={road + line * 1.4} strokeLinejoin="round" />
        <path d={outline} fill="none" stroke={palette.ink800} strokeWidth={road - line * 1.4} strokeLinejoin="round" />
        {highlight && (
          <path d={highlight} fill="none" stroke={palette.signal} strokeOpacity={0.16} strokeWidth={road * 0.9} strokeLinecap="round" strokeLinejoin="round" />
        )}
        <path d={refPath} fill="none" stroke={palette.ref} strokeWidth={line} strokeLinecap="round" strokeLinejoin="round" />
        <path d={cmpPath} fill="none" stroke={palette.cmp} strokeWidth={line} strokeLinecap="round" strokeLinejoin="round" />
        <Dots cursor={cursor} unit={unit} refTrace={refTrace} cmpTrace={cmpTrace} />
      </svg>
      <div className="absolute bottom-3 left-3 flex gap-1">
        {buttons.map((b) => (
          <button
            key={b.label}
            onClick={b.run}
            aria-label={b.label}
            className="flex h-8 w-8 items-center justify-center rounded border border-line-strong bg-ink-900 font-display text-[16px] text-bone-dim transition-colors hover:text-signal"
          >
            {b.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
