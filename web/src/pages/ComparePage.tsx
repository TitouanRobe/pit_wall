import { Select } from "@mantine/core";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Comparison, CornerComparison, Corner, Lap, TrackMap } from "../api";
import { TrackChooser } from "../components/TrackChooser";
import { DeltaMap } from "../components/TrackMap";
import { cornerDirections, type Direction } from "../lib/corners";
import { TrajectoryMap } from "../components/TrajectoryMap";
import { TraceChart, type ChartSeries } from "../components/TraceChart";
import { ErrorBlock, LoadingBlock, PageTitle, SectionTitle, SeriesSwatch } from "../components/ui";
import { createStore } from "../lib/cursor";
import { distance, lapTime, shortDate, signed } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePalette } from "../lib/mode";

const CORNER_ZOOM_PAD_M = 60;

function ComparePicker() {
  const [, setParams] = useSearchParams();

  const pick = async (slug: string) => {
    const laps: Lap[] = await fetch(`/api/tracks/${slug}/laps`).then((r) => r.json());
    const clean = laps.filter((l) => l.valid && !l.is_out_lap && !l.is_in_lap);
    const [a, b] = clean.length >= 2 ? clean : laps;
    if (a && b) setParams({ ref: String(a.id), cmp: String(b.id) });
  };

  return (
    <TrackChooser
      eyebrow="Lap comparison"
      action="Best vs second best"
      emptyText="Record a few laps first. Comparisons need at least two complete laps on the same circuit."
      onPick={pick}
    />
  );
}
function LapSelect({ value, laps, color, role, onChange }: { value: number; laps: Lap[]; color: string; role: string; onChange: (id: string) => void }) {
  const groups = useMemo(() => {
    const bySession = new Map<number, Lap[]>();
    for (const l of laps) bySession.set(l.session_id, [...(bySession.get(l.session_id) ?? []), l]);
    return [...bySession.values()].map((items) => ({
      group: `${shortDate(items[0].started_at)} · ${items[0].car_name}`,
      items: items.map((l) => ({
        value: String(l.id),
        label: `${lapTime(l.lap_time_ms)}  ·  Lap ${l.lap_number}${l.valid ? "" : " (invalid)"}`,
      })),
    }));
  }, [laps]);

  return (
    <div className="panel relative flex-1 overflow-hidden px-4 py-3">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <div className="label mb-1.5">{role}</div>
      <Select
        data={groups}
        value={String(value)}
        onChange={(v) => v && onChange(v)}
        allowDeselect={false}
        searchable
        maxDropdownHeight={320}
        aria-label={`${role} lap`}
        styles={{ input: { fontFamily: "JetBrains Mono, monospace", fontSize: 15 } }}
      />
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const palette = usePalette();
  const slower = delta > 0;
  return (
    <div className="panel flex min-w-[210px] flex-col justify-center px-5 py-3">
      <div className="label">Gap at the line</div>
      <div className="num mt-1 text-[30px] leading-none" style={{ color: Math.abs(delta) < 0.0005 ? palette.bone : slower ? palette.loss : palette.gain }}>
        {signed(delta)} s
      </div>
      <div className="mt-1 text-[12px] text-bone-dim">Compared lap is {slower ? "slower" : "faster"}</div>
    </div>
  );
}

function Insights({ corners, onZoom }: { corners: CornerComparison[]; onZoom: (c: Corner) => void }) {
  const palette = usePalette();
  const top = [...corners].sort((a, b) => Math.abs(b.delta_s) - Math.abs(a.delta_s)).slice(0, 3);
  if (!top.length) return null;
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-3">
      {top.map((c, i) => (
        <motion.button
          key={c.index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i }}
          onClick={() => onZoom(c)}
          className="panel group px-4 py-3 text-left transition-colors hover:border-line-strong"
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-bold uppercase tracking-[0.06em]">{c.name}</span>
            <span className="num text-[15px]" style={{ color: c.delta_s > 0 ? palette.loss : palette.gain }}>
              {signed(c.delta_s)} s
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-bone-dim">{c.insight.split(": ").slice(1).join(": ") || "Same lines, small differences everywhere."}</p>
          <span className="label mt-2 block transition-colors group-hover:!text-signal">Zoom in →</span>
        </motion.button>
      ))}
    </div>
  );
}

function DeltaCell({ value, max }: { value: number; max: number }) {
  const palette = usePalette();
  const width = Math.min(1, Math.abs(value) / max) * 50;
  const color = value > 0 ? palette.loss : palette.gain;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[6px] w-20 rounded-full bg-ink-700">
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <span className="absolute inset-y-0 rounded-full" style={{ background: color, width: `${width}%`, left: value > 0 ? "50%" : `${50 - width}%` }} />
      </div>
      <span className="num w-[7ch] text-right" style={{ color }}>{signed(value)}</span>
    </div>
  );
}

function metersDiff(a: number | null, b: number | null): string {
  if (a == null || b == null) return "-";
  const d = b - a;
  return Math.abs(d) < 1 ? "same" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)} m`;
}

function CornerTable({ corners, onZoom }: { corners: CornerComparison[]; onZoom: (c: Corner) => void }) {
  const max = Math.max(0.05, ...corners.map((c) => Math.abs(c.delta_s)));
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[460px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="label px-4 py-2.5">Corner</th>
            <th className="label px-2 py-2.5">Δ time</th>
            <th className="label px-2 py-2.5 text-right">Apex km/h</th>
            <th className="label px-2 py-2.5 text-right">Brake</th>
            <th className="label px-4 py-2.5 text-right">Throttle</th>
          </tr>
        </thead>
        <tbody>
          {corners.map((c) => (
            <tr key={c.index} onClick={() => onZoom(c)} className="cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-ink-800">
              <td className="px-4 py-2 font-display text-[15px] font-semibold uppercase tracking-[0.06em]">{c.name}</td>
              <td className="px-2 py-2"><DeltaCell value={c.delta_s} max={max} /></td>
              <td className="num px-2 py-2 text-right">
                <span className="text-ref">{Math.round(c.ref.min_speed_kmh)}</span>
                <span className="text-mute"> / </span>
                <span className="text-cmp">{Math.round(c.cmp.min_speed_kmh)}</span>
              </td>
              <td className="num px-2 py-2 text-right text-bone-dim">{metersDiff(c.ref.brake_s, c.cmp.brake_s)}</td>
              <td className="num px-4 py-2 text-right text-bone-dim">{metersDiff(c.ref.full_throttle_s, c.cmp.full_throttle_s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-[12px] text-mute">
        Brake and throttle columns show where the compared lap brakes or reaches full throttle relative to the reference. Positive means later.
      </p>
    </div>
  );
}

const FILTERS: { id: "all" | Direction; label: string }[] = [
  { id: "all", label: "All" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

function CornerPicker({
  corners,
  directions,
  active,
  full,
  onPick,
  onFull,
}: {
  corners: CornerComparison[];
  directions: Direction[];
  active: number | null;
  full: boolean;
  onPick: (c: Corner) => void;
  onFull: () => void;
}) {
  const palette = usePalette();
  const [filter, setFilter] = useState<"all" | Direction>("all");
  const rows = corners.filter((c) => filter === "all" || directions[c.index] === filter);
  return (
    <div className="flex min-h-0 flex-col lg:max-h-[78vh]">
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Corner direction">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`flex-1 rounded border px-2 py-1 font-display text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              filter === f.id ? "border-signal text-signal" : "border-line text-bone-dim hover:text-bone"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <button
        onClick={onFull}
        className={`mb-1 rounded px-3 py-2 text-left font-display text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-ink-800 ${
          full ? "text-signal" : "text-bone-dim"
        }`}
      >
        Full circuit
      </button>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {rows.map((c) => (
          <button
            key={c.index}
            onClick={() => onPick(c)}
            aria-pressed={active === c.index}
            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left transition-colors hover:bg-ink-800 ${
              active === c.index ? "bg-ink-800 shadow-[inset_2px_0_0_var(--color-signal)]" : ""
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="w-4 text-center text-bone-dim" aria-label={`${directions[c.index]} turn`}>
                {directions[c.index] === "left" ? "↰" : "↱"}
              </span>
              <span className="font-display text-[15px] font-semibold uppercase tracking-[0.06em]">{c.name}</span>
            </span>
            <span className="num text-[13px]" style={{ color: c.delta_s > 0 ? palette.loss : palette.gain }}>
              {signed(c.delta_s)}
            </span>
          </button>
        ))}
        {!rows.length && <p className="px-3 py-2 text-[13px] text-mute">No corners in this direction.</p>}
      </div>
    </div>
  );
}

function CompareView({ refId, cmpId }: { refId: number; cmpId: number }) {
  const palette = usePalette();
  const [, setParams] = useSearchParams();
  const { data, error, loading } = useApi<Comparison>(`/compare?ref=${refId}&cmp=${cmpId}`);
  const map = useApi<TrackMap>(data ? `/tracks/${data.track}/map` : null);
  const library = useApi<Lap[]>(data ? `/tracks/${data.track}/laps` : null);
  const cursor = useMemo(() => createStore<number | null>(null), []);
  const length = data ? data.ref.trace.s[data.ref.trace.s.length - 1] : 0;
  const [domain, setDomain] = useState<[number, number]>([0, 1]);

  useEffect(() => {
    if (length) setDomain([0, length]);
  }, [length]);

  const series = useMemo(() => {
    if (!data) return null;
    const r = data.ref.trace;
    const c = data.cmp.trace;
    const pair = (key: keyof typeof r): ChartSeries[] => [
      { id: "ref", label: `Lap ${data.ref.lap_number}`, color: palette.ref, values: r[key] },
      { id: "cmp", label: `Lap ${data.cmp.lap_number}`, color: palette.cmp, values: c[key] },
    ];
    return {
      delta: [{ id: "delta", label: "Δ", color: palette.bone, values: data.delta_s }],
      speed: pair("speed_kmh"),
      throttle: pair("throttle_pct"),
      brake: pair("brake_pct"),
      gear: pair("gear"),
      steering: pair("steering_pct"),
      maxGear: Math.max(...r.gear, ...c.gear),
      steerMax: Math.max(20, ...r.steering_pct.map(Math.abs), ...c.steering_pct.map(Math.abs)),
    };
  }, [data, palette]);

  if (error) return <ErrorBlock message={error} />;
  if (!data || !series) return <LoadingBlock height={520} />;

  const s = data.ref.trace.s;
  const zoomTo = (c: Corner) => setDomain([Math.max(0, c.s_start - CORNER_ZOOM_PAD_M), Math.min(length, c.s_end + CORNER_ZOOM_PAD_M)]);
  const reset = () => setDomain([0, length]);
  const zoomed = domain[0] > 0 || domain[1] < length;
  const select = (role: "ref" | "cmp") => (v: string) =>
    setParams(role === "ref" ? { ref: v, cmp: String(cmpId) } : { ref: String(refId), cmp: v });
  const directions = cornerDirections(data.corners, data.ref.trace);
  const activeCorner =
    data.corners.find(
      (c) => domain[0] === Math.max(0, c.s_start - CORNER_ZOOM_PAD_M) && domain[1] === Math.min(length, c.s_end + CORNER_ZOOM_PAD_M),
    )?.index ?? null;
  const common = { s, domain, cursor, corners: data.corners, onZoom: setDomain, onReset: reset };

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }} className="transition-opacity">
      <div className="mb-3 text-[13px] text-mute">
        <Link to={`/sessions/${data.ref.session_id}`} className="hover:text-bone">{data.ref.track_name}</Link>
        <span className="mx-2">/</span>
        <span className="text-bone-dim">Lap comparison</span>
      </div>
      <PageTitle eyebrow={`${data.ref.car_name}${data.ref.class ? ` · ${data.ref.class}` : ""}`} title={data.ref.track_name} />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row">
        <LapSelect role="Reference" value={refId} laps={library.data ?? [data.ref, data.cmp]} color={palette.ref} onChange={select("ref")} />
        <button
          onClick={() => setParams({ ref: String(cmpId), cmp: String(refId) })}
          className="panel flex items-center justify-center px-4 font-display text-[13px] font-semibold uppercase tracking-[0.1em] text-bone-dim transition-colors hover:text-signal"
          aria-label="Swap reference and compared laps"
        >
          ⇄ Swap
        </button>
        <LapSelect role="Compared" value={cmpId} laps={library.data ?? [data.ref, data.cmp]} color={palette.cmp} onChange={select("cmp")} />
        <DeltaBadge delta={data.delta_s[data.delta_s.length - 1]} />
      </div>

      <SectionTitle aside="Ranked by time gained or lost">Where the time goes</SectionTitle>
      <Insights corners={data.corners} onZoom={zoomTo} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <div className="min-w-0 space-y-4 xl:sticky xl:top-[84px]">
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <span className="label !text-bone-dim">Track map</span>
              <div className="flex gap-4 text-[12px] text-bone-dim">
                <SeriesSwatch color={palette.gain} label="Gaining" />
                <SeriesSwatch color={palette.loss} label="Losing" />
              </div>
            </div>
            <div className="mt-2 aspect-[4/3] w-full">
              {map.data ? (
                <DeltaMap
                  map={map.data}
                  delta={data.delta_s}
                  refTrace={data.ref.trace}
                  cmpTrace={data.cmp.trace}
                  cursor={cursor}
                  domain={domain}
                  onCornerClick={zoomTo}
                />
              ) : (
                <div className="grain h-full w-full rounded-md" />
              )}
            </div>
            <div className="mt-2 flex gap-4 text-[12px] text-bone-dim">
              <SeriesSwatch color={palette.ref} label={`Lap ${data.ref.lap_number} · ${lapTime(data.ref.lap_time_ms)}`} />
              <SeriesSwatch color={palette.cmp} label={`Lap ${data.cmp.lap_number} · ${lapTime(data.cmp.lap_time_ms)}`} />
            </div>
          </div>
          <CornerTable corners={data.corners} onZoom={zoomTo} />
        </div>

        <div className="panel min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="num text-[12px] text-bone-dim">
              {distance(domain[0])} to {distance(domain[1])}
            </span>
            <div className="flex items-center gap-4">
              <span className="hidden text-[12px] text-mute md:inline">Drag to zoom. Double click to reset.</span>
              <button
                onClick={reset}
                disabled={!zoomed}
                className="font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-signal transition-opacity disabled:opacity-30"
              >
                Full lap
              </button>
            </div>
          </div>
          <TraceChart {...common} title="Time delta (s)" series={series.delta} height={130} format={(v) => signed(v, 2)} delta showCornerLabels />
          <TraceChart {...common} title="Speed (km/h)" series={series.speed} height={200} format={(v) => v.toFixed(0)} />
          <TraceChart {...common} title="Throttle (%)" series={series.throttle} height={90} yRange={[0, 100]} format={(v) => v.toFixed(0)} />
          <TraceChart {...common} title="Brake (%)" series={series.brake} height={90} yRange={[0, 100]} format={(v) => v.toFixed(0)} />
          <TraceChart {...common} title="Gear" series={series.gear} height={80} yRange={[0, series.maxGear + 1]} curve="stepAfter" format={(v) => v.toFixed(0)} />
          <TraceChart
            {...common}
            title="Steering (%)"
            series={series.steering}
            height={90}
            yRange={[-series.steerMax, series.steerMax]}
            format={(v) => v.toFixed(0)}
            showXAxis
          />
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label !text-bone-dim">Racing lines</span>
          <div className="flex flex-wrap items-center gap-4 text-[12px] text-bone-dim">
            <span className="hidden text-mute md:inline">Drag to pan. Scroll to zoom.</span>
            <SeriesSwatch color={palette.ref} label={`Lap ${data.ref.lap_number}`} />
            <SeriesSwatch color={palette.cmp} label={`Lap ${data.cmp.lap_number}`} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
          <CornerPicker
            corners={data.corners}
            directions={directions}
            active={activeCorner}
            onPick={zoomTo}
            onFull={reset}
            full={!zoomed}
          />
          <div className="aspect-[2/1] max-h-[78vh] min-h-[320px] w-full overflow-hidden rounded-md bg-ink-900">
            <TrajectoryMap refTrace={data.ref.trace} cmpTrace={data.cmp.trace} cursor={cursor} domain={domain} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [params] = useSearchParams();
  const ref = Number(params.get("ref"));
  const cmp = Number(params.get("cmp"));
  if (!ref || !cmp) return <ComparePicker />;
  return <CompareView refId={ref} cmpId={cmp} />;
}
