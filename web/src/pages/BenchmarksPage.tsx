import { TextInput } from "@mantine/core";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Benchmarks, DrivenTrack, PaceReference, Placement, Tier, TierKey } from "../api";
import { TierLadder, tierOf } from "../components/TierLadder";
import { Chip, ErrorBlock, LoadingBlock, PageTitle, SectionTitle, SeriesSwatch, StatTile } from "../components/ui";
import { dateTime, lapTime, sessionType } from "../lib/format";
import { usePalette, useTierColors } from "../lib/mode";
import { useApi } from "../lib/useApi";

type Metric = "best" | "pace";

const METRICS: { key: Metric; label: string; hint: string }[] = [
  { key: "best", label: "Best lap", hint: "fastest valid lap" },
  { key: "pace", label: "Race pace", hint: "median clean lap of a session" },
];

const PCT_COLUMNS = [100, 101, 102, 103, 104, 105, 106, 107];

const tierAt = (tiers: Tier[], pct: number) => tiers.find((t) => t.max_pct == null || pct <= t.max_pct) ?? tiers[tiers.length - 1];

function TierBadge({ tiers, tier, size = "sm" }: { tiers: Tier[]; tier: TierKey | null; size?: "sm" | "lg" }) {
  const colors = useTierColors();
  const def = tierOf(tiers, tier);
  if (!def || !tier) return <span className="text-mute">-</span>;
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-semibold uppercase ${
        size === "lg" ? "text-[30px] leading-none tracking-[0.04em] sm:text-[36px]" : "text-[13px] tracking-[0.1em]"
      }`}
      style={{ color: colors[tier] }}
    >
      <span className={size === "lg" ? "h-3 w-3 rounded-[3px]" : "h-2 w-2 rounded-[2px]"} style={{ background: colors[tier] }} />
      {def.label}
    </span>
  );
}

function MetricToggle({ value, onChange }: { value: Metric; onChange: (m: Metric) => void }) {
  return (
    <div role="group" aria-label="Lap to benchmark" className="flex rounded-[6px] border border-line p-[3px]">
      {METRICS.map((m) => {
        const on = m.key === value;
        return (
          <button
            key={m.key}
            type="button"
            aria-pressed={on}
            title={m.hint}
            onClick={() => onChange(m.key)}
            className={`relative rounded-[4px] px-4 py-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              on ? "text-ink-950" : "text-mute hover:text-bone-dim"
            }`}
          >
            {on && <motion.span layoutId="metric-pill" className="absolute inset-0 rounded-[4px] bg-signal" transition={{ duration: 0.18 }} />}
            <span className="relative">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function NextTier({ tiers, placement, alienMs }: { tiers: Tier[]; placement: Placement; alienMs: number }) {
  const colors = useTierColors();
  const index = tiers.findIndex((t) => t.key === placement.tier);
  if (index <= 0 || placement.time_ms == null) {
    return <span className="text-bone-dim">On Alien race pace</span>;
  }
  const target = tiers[index - 1];
  const gap = placement.time_ms - (alienMs * (target.max_pct ?? 100)) / 100;
  return (
    <span className="text-bone-dim">
      <span className="num text-bone">{(gap / 1000).toFixed(2)} s</span> to{" "}
      <span className="font-semibold" style={{ color: colors[target.key] }}>{target.label}</span>
    </span>
  );
}

function SessionRows({ tiers, driven }: { tiers: Tier[]; driven: DrivenTrack }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full min-w-[820px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line">
            <th className="label px-4 py-2.5 font-semibold">Session</th>
            <th className="label px-4 py-2.5 font-semibold">Car</th>
            <th className="label px-4 py-2.5 text-right font-semibold">Clean laps</th>
            <th className="label px-4 py-2.5 text-right font-semibold">Best lap</th>
            <th className="label px-4 py-2.5 font-semibold">Tier</th>
            <th className="label px-4 py-2.5 text-right font-semibold">Race pace</th>
            <th className="label px-4 py-2.5 font-semibold">Tier</th>
          </tr>
        </thead>
        <tbody>
          {[...driven.sessions].reverse().map((s) => (
            <tr
              key={s.session_id}
              onClick={() => navigate(`/sessions/${s.session_id}`)}
              className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-ink-800"
            >
              <td className="whitespace-nowrap px-4 py-2.5 text-bone-dim">
                {dateTime(s.started_at)}
                <div className="text-[12px] text-mute">{sessionType(s.session_type)}</div>
              </td>
              <td className="px-4 py-2.5">{s.car_name}</td>
              <td className="num px-4 py-2.5 text-right text-bone-dim">{s.laps}</td>
              <td className="num whitespace-nowrap px-4 py-2.5 text-right">
                {lapTime(s.best.time_ms)}
                <div className="text-[12px] text-mute">{s.best.pct != null ? `${s.best.pct.toFixed(2)}%` : ""}</div>
              </td>
              <td className="px-4 py-2.5"><TierBadge tiers={tiers} tier={s.best.tier} /></td>
              <td className="num whitespace-nowrap px-4 py-2.5 text-right">
                {s.pace.time_ms != null ? lapTime(s.pace.time_ms) : <span className="text-mute">too few laps</span>}
                <div className="text-[12px] text-mute">{s.pace.pct != null ? `${s.pace.pct.toFixed(2)}%` : ""}</div>
              </td>
              <td className="px-4 py-2.5"><TierBadge tiers={tiers} tier={s.pace.tier} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrivenCard({
  tiers,
  driven,
  reference,
  metric,
  index,
}: {
  tiers: Tier[];
  driven: DrivenTrack;
  reference: PaceReference;
  metric: Metric;
  index: number;
}) {
  const palette = usePalette();
  const colors = useTierColors();
  const placement = driven[metric];
  const other = driven[metric === "best" ? "pace" : "best"];
  const otherLabel = metric === "best" ? "Race pace" : "Best lap";
  const tier = placement.tier;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.3 }}
      className="panel relative overflow-hidden"
    >
      {tier && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: colors[tier] }} />}
      <div className="grid md:grid-cols-[300px_1fr]">
        <div className="border-b border-line bg-ink-850 px-6 py-5 md:border-b-0 md:border-r">
          <div className="label">Circuit</div>
          <h2 className="mt-1 font-display text-2xl font-semibold uppercase leading-tight">{driven.track_name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>{driven.car_class}</Chip>
            <Chip>Benchmark · {reference.track}</Chip>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <div className="label">Alien pace</div>
              <div className="num mt-1 text-bone">{lapTime(reference.alien_ms, 2)}</div>
            </div>
            <div>
              <div className="label">Hotlap avg</div>
              <div className="num mt-1 text-bone">{lapTime(reference.hotlap_avg_ms, 2)}</div>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          {placement.pct == null || !tier ? (
            <div className="flex h-full items-center text-[14px] text-bone-dim">
              Race pace needs at least 3 clean laps in one session. Switch to best lap, or run a longer stint.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <div className="label mb-2">{metric === "best" ? "Your best lap sits in" : "Your race pace sits in"}</div>
                  <TierBadge tiers={tiers} tier={tier} size="lg" />
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <div className="label">{metric === "best" ? "Best lap" : "Race pace"}</div>
                    <div className="num mt-1 text-[22px] text-bone">{lapTime(placement.time_ms)}</div>
                  </div>
                  <div>
                    <div className="label">Of Alien pace</div>
                    <div className="num mt-1 text-[22px]" style={{ color: colors[tier] }}>{placement.pct.toFixed(2)}%</div>
                  </div>
                  <div>
                    <div className="label">Next tier</div>
                    <div className="mt-1.5 text-[15px]">
                      <NextTier tiers={tiers} placement={placement} alienMs={reference.alien_ms} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5">
                <TierLadder
                  tiers={tiers}
                  alienMs={reference.alien_ms}
                  measure={{ pct: placement.pct, label: metric === "best" ? "Best lap" : "Race pace", tier }}
                  marker={other.pct != null ? { pct: other.pct, label: otherLabel } : undefined}
                />
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-[12px] text-mute">
                  <span>% of Alien race pace, lower is faster</span>
                  {other.pct != null && (
                    <SeriesSwatch color={palette.bone} label={`${otherLabel} ${other.pct.toFixed(2)}%`} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <SessionRows tiers={tiers} driven={driven} />
    </motion.section>
  );
}

function Unmatched({ items }: { items: DrivenTrack[] }) {
  return (
    <div className="panel grain mt-6 px-6 py-5">
      <div className="label mb-2">No benchmark matched</div>
      <ul className="space-y-1.5 text-[14px] text-bone-dim">
        {items.map((d) => (
          <li key={d.track + d.car_class}>
            <span className="text-bone">{d.track_name}</span> <span className="text-mute">({d.car_class})</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-mute">
        Set <code className="num text-bone-dim">game_track</code> in the <code className="num text-bone-dim">pace_reference</code> table
        of <code className="num text-bone-dim">data/index.sqlite</code> to the circuit name shown here.
      </p>
    </div>
  );
}

function ReferenceTable({
  tiers,
  references,
  mine,
  metric,
}: {
  tiers: Tier[];
  references: PaceReference[];
  mine: Map<number, DrivenTrack>;
  metric: Metric;
}) {
  const colors = useTierColors();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return references.filter((r) => !q || `${r.track} ${r.game_track ?? ""}`.toLowerCase().includes(q));
  }, [references, query]);
  const columns = PCT_COLUMNS.map((pct) => ({ pct, tier: tierAt(tiers, pct) }));
  const showClass = new Set(references.map((r) => r.car_class)).size > 1;

  return (
    <>
      <SectionTitle
        aside={
          <TextInput
            aria-label="Filter circuits"
            placeholder="Filter circuits"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            size="xs"
            w={220}
          />
        }
      >
        Reference times
      </SectionTitle>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[1240px] text-[14px]">
          <thead className="whitespace-nowrap">
            <tr className="border-b border-line">
              <th className="label sticky left-0 z-10 bg-ink-900 px-4 pb-2 pt-4 text-left font-semibold" rowSpan={2}>Circuit</th>
              <th className="label px-3 pb-2 pt-4 text-right font-semibold" rowSpan={2}>{metric === "best" ? "Your best" : "Your pace"}</th>
              <th className="label border-r border-line px-3 pb-2 pt-4 text-right font-semibold" rowSpan={2}>Hotlap avg</th>
              {columns.map((c, i) => {
                const first = i === 0 || columns[i - 1].tier.key !== c.tier.key;
                return (
                  <th key={c.pct} className="px-3 pt-3 text-right align-bottom font-semibold">
                    <span className="block h-[3px] rounded-full" style={{ background: colors[c.tier.key], opacity: 0.85 }} />
                    <span className="label mt-2 block !text-[11px]" style={{ color: first ? colors[c.tier.key] : "transparent" }}>
                      {c.tier.label}
                    </span>
                  </th>
                );
              })}
              <th className="label border-l border-line px-4 pb-2 pt-4 text-left font-semibold" rowSpan={2}>Fastest car</th>
              <th className="label px-4 pb-2 pt-4 text-right font-semibold" rowSpan={2}>Hotlap</th>
            </tr>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th key={c.pct} className="num px-3 pb-2 pt-1 text-right text-[11px] font-normal text-mute">
                  {c.pct === 100 ? "~100%" : `${c.pct}%`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const driven = mine.get(r.id);
              const you = driven?.[metric];
              const beaten = you?.pct != null ? PCT_COLUMNS.find((pct) => you.pct! <= pct) : undefined;
              return (
                <tr key={r.id} className={`group border-b border-line/70 last:border-b-0 ${driven ? "bg-signal/[0.04]" : ""}`}>
                  <td className={`sticky left-0 z-10 whitespace-nowrap px-4 py-2.5 ${driven ? "bg-ink-850" : "bg-ink-900"}`}>
                    <span className={driven ? "font-semibold text-bone" : "text-bone"}>{r.track}</span>
                    {showClass && <span className="ml-2 text-[12px] text-mute">{r.car_class}</span>}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                    {you?.time_ms && you.tier ? (
                      <span style={{ color: colors[you.tier] }} title={`${you.pct?.toFixed(2)}% of Alien pace`}>
                        {lapTime(you.time_ms, 2)}
                      </span>
                    ) : (
                      <span className="text-mute">-</span>
                    )}
                  </td>
                  <td className="num border-r border-line px-3 py-2.5 text-right text-mute">{lapTime(r.hotlap_avg_ms, 2)}</td>
                  {columns.map((c) => {
                    const here = c.pct === beaten;
                    return (
                      <td
                        key={c.pct}
                        className="num whitespace-nowrap px-3 py-2.5 text-right text-bone-dim"
                        style={here ? { color: colors[c.tier.key], fontWeight: 600 } : undefined}
                      >
                        {lapTime((r.alien_ms * c.pct) / 100, 2)}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap border-l border-line px-4 py-2.5 text-bone-dim">{r.fastest_car ?? "-"}</td>
                  <td className="num px-4 py-2.5 text-right text-bone-dim">{lapTime(r.fastest_ms, 2)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={PCT_COLUMNS.length + 5} className="px-4 py-8 text-center text-mute">No circuit matches “{query}”.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-mute">
        Race pace tiers as a percentage of the Alien reference. A tier is reached by lapping at or under its time. Community
        reference, {[...new Set(references.map((r) => `patch ${r.patch}`))].join(", ")}.
      </p>
    </>
  );
}

export default function BenchmarksPage() {
  const { data, error } = useApi<Benchmarks>("/benchmarks");
  const colors = useTierColors();
  const [params, setParams] = useSearchParams();
  const metric: Metric = params.get("metric") === "pace" ? "pace" : "best";

  const view = useMemo(() => {
    if (!data) return null;
    const refs = new Map(data.references.map((r) => [r.id, r]));
    const matched = data.driven.filter((d) => d.reference_id != null);
    const mine = new Map(matched.map((d) => [d.reference_id as number, d]));
    const classes = [...new Set(data.references.map((r) => r.car_class))];
    return { refs, matched, mine, classes, unmatched: data.driven.filter((d) => d.reference_id == null) };
  }, [data]);

  if (error) return <ErrorBlock message={error} />;
  if (!data || !view) return <LoadingBlock height={480} />;

  const { refs, matched, mine, classes, unmatched } = view;
  const placed = matched.filter((d) => d[metric].pct != null);
  const top = [...placed].sort((a, b) => (a[metric].pct ?? 0) - (b[metric].pct ?? 0))[0];
  const avg = placed.length ? placed.reduce((n, d) => n + (d[metric].pct ?? 0), 0) / placed.length : null;
  const avgTier = avg != null ? tierAt(data.tiers, avg) : null;
  const setMetric = (m: Metric) => setParams(m === "best" ? {} : { metric: m }, { replace: true });

  return (
    <>
      <PageTitle eyebrow={`Pace benchmarks · ${classes.join(", ")}`} title="Where you stand">
        {matched.length > 0 && <MetricToggle value={metric} onChange={setMetric} />}
      </PageTitle>

      {matched.length > 0 && (
        <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile index={0} label="Circuits benchmarked" value={<span className="num">{matched.length}</span>} hint={`of ${data.references.length} references`} />
          <StatTile
            index={1}
            label="Strongest circuit"
            accent={top?.[metric].tier ? colors[top[metric].tier] : undefined}
            value={<span className="num">{top?.[metric].pct != null ? `${top[metric].pct.toFixed(2)}%` : "-"}</span>}
            hint={top ? `${top.track_name}, ${tierOf(data.tiers, top[metric].tier)?.label}` : "No placement yet"}
          />
          <StatTile
            index={2}
            label="Average placement"
            accent={avgTier ? colors[avgTier.key] : undefined}
            value={<span className="num">{avg != null ? `${avg.toFixed(2)}%` : "-"}</span>}
            hint={avgTier ? avgTier.label : "No placement yet"}
          />
          <StatTile
            index={3}
            label="Sessions placed"
            value={<span className="num">{matched.reduce((n, d) => n + d.sessions.length, 0)}</span>}
            hint={`ranked on ${METRICS.find((m) => m.key === metric)?.hint}`}
          />
        </div>
      )}

      {matched.length > 0 ? (
        <div className="space-y-6">
          {matched.map((d, i) => (
            <DrivenCard key={d.track + d.car_class} tiers={data.tiers} driven={d} reference={refs.get(d.reference_id as number)!} metric={metric} index={i} />
          ))}
        </div>
      ) : (
        <div className="panel grain px-8 py-10">
          <div className="label mb-2">No placement yet</div>
          <p className="max-w-xl text-bone-dim">
            Drive a circuit from the list below with a car of the same class, and your laps will be placed against the reference.
          </p>
        </div>
      )}
      {unmatched.length > 0 && <Unmatched items={unmatched} />}

      <div className="mt-12">
        <ReferenceTable tiers={data.tiers} references={data.references} mine={mine} metric={metric} />
      </div>
    </>
  );
}
