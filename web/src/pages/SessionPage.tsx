import { Button, Checkbox, Tooltip } from "@mantine/core";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteSession, setSessionHidden, type Lap, type SessionDetail } from "../api";
import { LapTimesChart } from "../components/LapTimesChart";
import { DeleteSessionModal, SessionMenu } from "../components/SessionActions";
import { Chip, ErrorBlock, LoadingBlock, PageTitle, SectionTitle, StatTile } from "../components/ui";
import { dateTime, lapTime, sectorTime, sessionType, signed, wetness } from "../lib/format";
import { useApi } from "../lib/useApi";
import { usePalette } from "../lib/mode";

const GAP_SCALE_S = 3;

function lapStatus(lap: Lap): { label: string; tone: "default" | "warn" } | null {
  if (lap.is_out_lap) return { label: "Out lap", tone: "default" };
  if (lap.is_in_lap) return { label: "In lap", tone: "default" };
  if (!lap.valid) return { label: "Invalid", tone: "warn" };
  if (!lap.in_grid) return { label: "Partial", tone: "default" };
  return null;
}

function LapTable({ laps, bestMs, selected, onToggle }: { laps: Lap[]; bestMs: number | null; selected: number[]; onToggle: (id: number) => void }) {
  const palette = usePalette();
  const navigate = useNavigate();
  const best = laps.find((l) => l.lap_time_ms === bestMs && l.in_grid);
  const clean = laps.filter((l) => l.valid && !l.is_out_lap && !l.is_in_lap);
  const bestSector = (key: "s1_ms" | "s2_ms" | "s3_ms") => Math.min(...clean.map((l) => l[key] ?? Infinity));
  const sectorBest = { s1_ms: bestSector("s1_ms"), s2_ms: bestSector("s2_ms"), s3_ms: bestSector("s3_ms") };
  const hasSectors = laps.some((l) => l.s1_ms != null);

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[760px] text-[14px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="w-10 px-4 py-3" />
            <th className="label px-2 py-3">Lap</th>
            <th className="label px-4 py-3 text-right">Time</th>
            <th className="label px-4 py-3">Gap to best</th>
            {hasSectors && ["S1", "S2", "S3"].map((h) => <th key={h} className="label px-4 py-3 text-right">{h}</th>)}
            <th className="label px-4 py-3 text-right">Top speed</th>
            <th className="label px-4 py-3 text-right">Fuel</th>
            <th className="label px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {laps.map((lap) => {
            const status = lapStatus(lap);
            const isBest = lap.id === best?.id;
            const gap = bestMs && lap.lap_time_ms && lap.valid ? (lap.lap_time_ms - bestMs) / 1000 : null;
            const selectable = !!lap.in_grid;
            return (
              <tr key={lap.id} className={`border-b border-line/60 last:border-b-0 ${selected.includes(lap.id) ? "bg-ink-800" : "hover:bg-ink-850"}`}>
                <td className="px-4 py-2.5">
                  <Checkbox
                    aria-label={`Select lap ${lap.lap_number}`}
                    checked={selected.includes(lap.id)}
                    disabled={!selectable}
                    onChange={() => onToggle(lap.id)}
                  />
                </td>
                <td className="num px-2 py-2.5 text-bone-dim">{String(lap.lap_number).padStart(2, "0")}</td>
                <td className={`num px-4 py-2.5 text-right ${isBest ? "text-best" : lap.valid ? "text-bone" : "text-mute line-through decoration-loss/60"}`}>
                  {lapTime(lap.lap_time_ms)}
                </td>
                <td className="px-4 py-2.5">
                  {gap != null && !lap.is_out_lap && !lap.is_in_lap && (
                    <div className="flex items-center gap-3">
                      <div className="relative h-[6px] w-28 overflow-hidden rounded-full bg-ink-700">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${Math.min(1, gap / GAP_SCALE_S) * 100}%`, background: isBest ? palette.best : palette.boneDim }}
                        />
                      </div>
                      <span className="num text-[13px] text-bone-dim">{isBest ? "best" : signed(gap)}</span>
                    </div>
                  )}
                </td>
                {hasSectors &&
                  (["s1_ms", "s2_ms", "s3_ms"] as const).map((k) => (
                    <td key={k} className={`num px-4 py-2.5 text-right ${lap[k] === sectorBest[k] ? "text-best" : "text-bone-dim"}`}>
                      {sectorTime(lap[k])}
                    </td>
                  ))}
                <td className="num px-4 py-2.5 text-right text-bone-dim">{lap.max_speed ? `${Math.round(lap.max_speed)}` : "-"}</td>
                <td className="num px-4 py-2.5 text-right text-bone-dim">{lap.fuel_used ? `${lap.fuel_used.toFixed(2)} L` : "-"}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {status && <Chip tone={status.tone}>{status.label}</Chip>}
                    {best && selectable && !isBest && (
                      <Tooltip label={`Compare with best lap (lap ${best.lap_number})`}>
                        <button
                          onClick={() => navigate(`/compare?ref=${best.id}&cmp=${lap.id}`)}
                          className="rounded-[4px] border border-line-strong px-2 py-[3px] font-display text-[12px] font-semibold uppercase tracking-[0.08em] text-bone-dim transition-colors hover:border-signal/60 hover:text-signal"
                        >
                          vs best
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QualityPanel({ detail }: { detail: SessionDetail }) {
  const q = detail.session.quality;
  if (!q) return null;
  const metrics = [
    ["Sample rate", `${q.sample_hz.toFixed(1)} Hz`],
    ["Timing jitter", `${q.dt_jitter_ms.toFixed(2)} ms`],
    ["Gaps", String(q.gaps)],
    ["Frames", q.frames.toLocaleString("en-GB")],
  ];
  return (
    <div className="panel p-5">
      <SectionTitle aside={q.warnings.length ? `${q.warnings.length} to review` : "All checks passed"}>Data quality</SectionTitle>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="num mt-1 text-bone">{v}</dd>
          </div>
        ))}
      </dl>
      {q.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[14px] text-bone-dim">
          {q.warnings.map((w) => (
            <li key={w.code + w.message} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-loss" aria-hidden />
              <span>
                <span className="sr-only">Warning: </span>
                {w.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail.session.notes && <p className="mt-4 border-t border-line pt-4 text-[13px] text-mute">{detail.session.notes}</p>}
    </div>
  );
}

export default function SessionPage() {
  const palette = usePalette();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<SessionDetail>(`/sessions/${id}`);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const byId = useMemo(() => new Map((data?.laps ?? []).map((l) => [l.id, l])), [data]);

  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock height={420} />;

  const { session, laps, stats } = data;
  const toggle = (lapId: number) =>
    setSelected((prev) => (prev.includes(lapId) ? prev.filter((x) => x !== lapId) : [...prev, lapId].slice(-2)));
  const validLaps = laps.filter((l) => l.valid).length;
  const ideal = stats.ideal;
  const [refLap, cmpLap] = [...selected].map((x) => byId.get(x)!).sort((a, b) => (a.lap_time_ms ?? 0) - (b.lap_time_ms ?? 0));

  const remove = async () => {
    await deleteSession(session.id);
    navigate("/");
  };

  const toggleHidden = async () => {
    await setSessionHidden(session.id, !session.hidden);
    reload();
  };

  return (
    <>
      <div className="mb-3 text-[13px] text-mute">
        <Link to="/" className="hover:text-bone">Sessions</Link>
        <span className="mx-2">/</span>
        <span className="text-bone-dim">{session.track_name}</span>
      </div>
      <PageTitle eyebrow={`${sessionType(session.session_type)} · ${dateTime(session.started_at)}`} title={session.track_name}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>
            {session.car_name}
            {session.class ? ` · ${session.class}` : ""}
          </Chip>
          {session.air_temp != null && <Chip>Air {Math.round(session.air_temp)}°C</Chip>}
          {session.track_temp != null && <Chip>Track {Math.round(session.track_temp)}°C</Chip>}
          {session.wetness != null && <Chip>{wetness(session.wetness)}</Chip>}
          {session.driver && <Chip>{session.driver}</Chip>}
          {session.source !== "live" && <Chip tone="signal">Rebuilt from legacy capture</Chip>}
          {session.hidden ? <Chip tone="warn">Hidden from analysis</Chip> : null}
          <SessionMenu hidden={!!session.hidden} onToggleHidden={toggleHidden} onDelete={() => setConfirmDelete(true)} />
        </div>
      </PageTitle>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Best lap" accent={palette.best} value={<span className="num">{lapTime(stats.best_ms)}</span>} />
        <StatTile
          index={1}
          label="Ideal lap"
          accent={palette.signal}
          value={<span className="num">{lapTime(ideal?.time_ms)}</span>}
          hint={ideal && stats.best_ms ? `${((stats.best_ms - ideal.time_ms) / 1000).toFixed(3)} s left on the table` : "Needs a track reference"}
        />
        <StatTile
          index={2}
          label="Consistency"
          value={stats.stdev_ms != null ? <span className="num">σ {(stats.stdev_ms / 1000).toFixed(3)}</span> : "-"}
          hint={stats.clean_laps ? `${stats.clean_laps} clean laps within 107%` : "No clean laps yet"}
        />
        <StatTile index={3} label="Laps" value={<span className="num">{validLaps}<span className="text-mute">/{laps.length}</span></span>} hint="valid / total" />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="panel p-5">
          <SectionTitle aside="Out and in laps excluded. Hollow markers are invalidated laps.">Lap times</SectionTitle>
          <div className="h-[280px]">
            <LapTimesChart laps={laps} bestMs={stats.best_ms} idealMs={ideal?.time_ms ?? null} />
          </div>
        </div>
        <div className="panel p-5">
          <SectionTitle aside="best segment per corner">Ideal lap</SectionTitle>
          {ideal ? (
            <ol className="max-h-[280px] space-y-0 overflow-y-auto pr-1">
              {ideal.segments.map((seg) => (
                <li key={seg.name} className="flex items-center justify-between border-b border-line/60 py-2 text-[14px] last:border-b-0">
                  <span className="font-display font-semibold uppercase tracking-[0.06em]">{seg.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-[12px] text-mute">lap {seg.lap_number}</span>
                    <span className="num text-bone">{seg.time_s.toFixed(3)}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[14px] text-mute">Drive one clean lap on this circuit to build its reference line and corner map.</p>
          )}
        </div>
      </div>

      <SectionTitle aside="Select two laps to compare them">Timing</SectionTitle>
      <LapTable laps={laps} bestMs={stats.best_ms} selected={selected} onToggle={toggle} />

      <div className="mt-8">
        <QualityPanel detail={data} />
      </div>

      <AnimatePresence>
        {selected.length === 2 && refLap && cmpLap && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-5 rounded-xl border border-line-strong bg-ink-850/95 px-5 py-3 shadow-2xl backdrop-blur"
          >
            <span className="flex items-center gap-2 text-[14px]">
              <span className="h-[3px] w-4 rounded-full bg-ref" />
              Lap {refLap.lap_number}
              <span className="num text-bone-dim">{lapTime(refLap.lap_time_ms)}</span>
            </span>
            <span className="text-mute">vs</span>
            <span className="flex items-center gap-2 text-[14px]">
              <span className="h-[3px] w-4 rounded-full bg-cmp" />
              Lap {cmpLap.lap_number}
              <span className="num text-bone-dim">{lapTime(cmpLap.lap_time_ms)}</span>
            </span>
            <Button size="xs" onClick={() => navigate(`/compare?ref=${refLap.id}&cmp=${cmpLap.id}`)}>
              Compare
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <DeleteSessionModal opened={confirmDelete} lapCount={laps.length} onClose={() => setConfirmDelete(false)} onConfirm={remove} />
    </>
  );
}
