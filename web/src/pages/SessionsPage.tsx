import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { deleteSession, setSessionHidden, type SessionListItem, type TrackMap } from "../api";
import { DeleteSessionModal, SessionMenu } from "../components/SessionActions";
import { TrackOutline } from "../components/TrackMap";
import { Chip, ErrorBlock, LoadingBlock, PageTitle, StatTile } from "../components/ui";
import { dateTime, distance, lapTime, sessionType, wetness } from "../lib/format";
import { useApi } from "../lib/useApi";

const UNCLASSIFIED = "Unclassified";

type SessionHandlers = {
  onToggleHidden: (session: SessionListItem) => void;
  onDelete: (session: SessionListItem) => void;
};

function EmptyState() {
  return (
    <div className="panel grain px-8 py-14">
      <div className="max-w-xl">
        <div className="label mb-3">Nothing on the timing screen yet</div>
        <h2 className="font-display text-3xl font-semibold uppercase">Go set a lap</h2>
        <p className="mt-3 text-bone-dim">
          Enable plugins in Le Mans Ultimate (Settings, Gameplay, Enable Plugins), start the recorder and drive. Each run
          is saved when you return to the garage.
        </p>
        <pre className="num mt-6 rounded-md border border-line bg-ink-950 px-4 py-3 text-[13px] text-bone">
          <span className="text-mute">$ </span>uv run lmu record
        </pre>
      </div>
    </div>
  );
}

function ClassFilter({
  classes,
  total,
  active,
  onChange,
}: {
  classes: { name: string; count: number }[];
  total: number;
  active: string | null;
  onChange: (name: string | null) => void;
}) {
  const items = [{ name: null as string | null, count: total }, ...classes];
  return (
    <div role="group" aria-label="Filter by car class" className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = item.name === active;
        return (
          <button
            key={item.name ?? "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.name)}
            className={`rounded-[4px] border px-3 py-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              on ? "border-signal bg-signal/10 text-bone" : "border-line text-mute hover:border-line-strong hover:text-bone-dim"
            }`}
          >
            {item.name ?? "All"}
            <span className="num ml-2 text-[11px] font-normal opacity-70">{item.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function TrackGroup({
  slug,
  sessions,
  index,
  showDriver,
  onToggleHidden,
  onDelete,
}: { slug: string; sessions: SessionListItem[]; index: number; showDriver: boolean } & SessionHandlers) {
  const navigate = useNavigate();
  const map = useApi<TrackMap>(`/tracks/${slug}/map`);
  const first = sessions[0];
  const counted = sessions.filter((s) => !s.hidden);
  const trackBest = Math.min(...counted.map((s) => s.best_ms ?? Infinity));
  const laps = counted.reduce((n, s) => n + s.laps, 0);

  const headers = [
    { label: "Date", right: false },
    { label: "Car", right: false },
    ...(showDriver ? [{ label: "Driver", right: false }] : []),
    { label: "Session", right: false },
    { label: "Conditions", right: false },
    { label: "Laps", right: true },
    { label: "Best", right: true },
    { label: "", right: true },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.3 }}
      className="panel overflow-hidden"
    >
      <div className="grid gap-0 md:grid-cols-[280px_1fr]">
        <div className="relative border-b border-line bg-ink-850 p-6 md:border-b-0 md:border-r">
          <div className="label">Circuit</div>
          <h2 className="mt-1 font-display text-2xl font-semibold uppercase leading-tight">{first.track_name}</h2>
          <div className="mt-1 text-[13px] text-bone-dim">
            {distance(first.length_m)} · {laps} laps logged
          </div>
          <div className="mt-4 aspect-square w-full max-w-[220px]">
            {map.data ? <TrackOutline map={map.data} className="h-full w-full" /> : <div className="grain h-full w-full rounded-md" />}
          </div>
          <div className="mt-4">
            <div className="label">Best lap</div>
            <div className="num mt-1 text-2xl text-best">{lapTime(Number.isFinite(trackBest) ? trackBest : null)}</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-[14px] ${showDriver ? "min-w-[780px]" : "min-w-[680px]"}`}>
            <thead>
              <tr className="border-b border-line">
                {headers.map((h, i) => (
                  <th key={h.label + i} className={`label px-4 py-3 font-semibold ${h.right ? "text-right" : ""}`}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/sessions/${s.id}`)}
                  className={`group cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-ink-800 ${s.hidden ? "opacity-55" : ""}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-bone-dim">
                    {dateTime(s.started_at)}
                    {s.hidden && <div className="text-[12px] text-mute">Hidden</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.car_name}</div>
                    {s.class && <div className="text-[12px] text-mute">{s.class}</div>}
                  </td>
                  {showDriver && <td className="whitespace-nowrap px-4 py-3 text-bone-dim">{s.driver ?? <span className="text-mute">-</span>}</td>}
                  <td className="px-4 py-3 text-bone-dim">
                    {sessionType(s.session_type)}
                    {s.source !== "live" && <div className="text-[12px] text-mute">Imported</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-bone-dim">
                    {s.track_temp != null ? `${Math.round(s.track_temp)}°C track · ` : ""}
                    {wetness(s.wetness)}
                  </td>
                  <td className="num px-4 py-3 text-right text-bone-dim">{s.laps}</td>
                  <td className={`num px-4 py-3 text-right ${!s.hidden && s.best_ms === trackBest ? "text-best" : ""}`}>{lapTime(s.best_ms)}</td>
                  <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {s.warnings > 0 ? (
                        <span title="Data quality warnings, open the session for details">
                          <Chip tone="warn">{s.warnings} QC</Chip>
                        </span>
                      ) : (
                        <span className="px-2 text-mute transition-colors group-hover:text-signal">→</span>
                      )}
                      <SessionMenu hidden={s.hidden} onToggleHidden={() => onToggleHidden(s)} onDelete={() => onDelete(s)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.section>
  );
}

export default function SessionsPage() {
  const { data, error, reload } = useApi<SessionListItem[]>("/sessions");
  const [params, setParams] = useSearchParams();
  const [showHidden, setShowHidden] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionListItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hiddenCount = useMemo(() => (data ?? []).filter((s) => s.hidden).length, [data]);
  const shown = useMemo(() => (data ?? []).filter((s) => showHidden || !s.hidden), [data, showHidden]);

  const classes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of shown) counts.set(s.class ?? UNCLASSIFIED, (counts.get(s.class ?? UNCLASSIFIED) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [shown]);

  const requested = params.get("class");
  const active = requested && classes.some((c) => c.name === requested) ? requested : null;
  const filtered = useMemo(() => shown.filter((s) => active == null || (s.class ?? UNCLASSIFIED) === active), [shown, active]);

  const groups = useMemo(() => {
    const byTrack = new Map<string, SessionListItem[]>();
    for (const s of filtered) byTrack.set(s.track, [...(byTrack.get(s.track) ?? []), s]);
    return [...byTrack.entries()];
  }, [filtered]);

  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const setClass = (name: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (name) next.set("class", name);
        else next.delete("class");
        return next;
      },
      { replace: true },
    );

  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock />;

  const counted = filtered.filter((s) => !s.hidden);
  const laps = counted.reduce((n, s) => n + s.laps, 0);
  const km = counted.reduce((n, s) => n + (s.laps * s.length_m) / 1000, 0);
  const showDriver = filtered.some((s) => s.driver);
  const showBar = classes.length > 1 || hiddenCount > 0;

  return (
    <>
      <PageTitle eyebrow="Garage" title="Sessions" />
      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {showBar && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              {classes.length > 1 ? <ClassFilter classes={classes} total={shown.length} active={active} onChange={setClass} /> : <span />}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHidden((v) => !v)}
                  className="rounded-[4px] border border-line px-3 py-1.5 text-[13px] text-mute transition-colors hover:border-line-strong hover:text-bone-dim"
                >
                  {showHidden ? "Hide hidden sessions" : `Show ${hiddenCount} hidden`}
                </button>
              )}
            </div>
          )}
          {actionError && (
            <div className="mb-6">
              <ErrorBlock message={actionError} />
            </div>
          )}
          <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile index={0} label="Sessions" value={counted.length} />
            <StatTile index={1} label="Laps" value={laps} />
            <StatTile index={2} label="Distance" value={`${Math.round(km).toLocaleString("en-GB")} km`} />
            <StatTile index={3} label="Circuits" value={groups.length} />
          </div>
          {groups.length === 0 ? (
            <div className="panel grain px-8 py-10 text-[14px] text-bone-dim">
              Every session is hidden. Use “Show {hiddenCount} hidden” to bring them back.
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(([slug, sessions], i) => (
                <TrackGroup
                  key={slug}
                  slug={slug}
                  sessions={sessions}
                  index={i}
                  showDriver={showDriver}
                  onToggleHidden={(s) => run(() => setSessionHidden(s.id, !s.hidden))}
                  onDelete={setPendingDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      <DeleteSessionModal
        opened={pendingDelete !== null}
        lapCount={pendingDelete?.laps ?? 0}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) run(() => deleteSession(target.id));
        }}
      />
    </>
  );
}
