import { motion } from "framer-motion";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionListItem, TrackMap } from "../api";
import { TrackOutline } from "../components/TrackMap";
import { Chip, ErrorBlock, LoadingBlock, PageTitle, StatTile } from "../components/ui";
import { dateTime, distance, lapTime, sessionType, wetness } from "../lib/format";
import { useApi } from "../lib/useApi";

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

function TrackGroup({ slug, sessions, index }: { slug: string; sessions: SessionListItem[]; index: number }) {
  const navigate = useNavigate();
  const map = useApi<TrackMap>(`/tracks/${slug}/map`);
  const first = sessions[0];
  const trackBest = Math.min(...sessions.map((s) => s.best_ms ?? Infinity));
  const laps = sessions.reduce((n, s) => n + s.laps, 0);

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
          <table className="w-full min-w-[640px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line">
                {["Date", "Car", "Session", "Conditions", "Laps", "Best", ""].map((h, i) => (
                  <th key={h + i} className={`label px-4 py-3 font-semibold ${i >= 4 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/sessions/${s.id}`)}
                  className="group cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-ink-800"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-bone-dim">{dateTime(s.started_at)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.car_name}</div>
                    {s.class && <div className="text-[12px] text-mute">{s.class}</div>}
                  </td>
                  <td className="px-4 py-3 text-bone-dim">
                    {sessionType(s.session_type)}
                    {s.source !== "live" && <div className="text-[12px] text-mute">Imported</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-bone-dim">
                    {s.track_temp != null ? `${Math.round(s.track_temp)}°C track · ` : ""}
                    {wetness(s.wetness)}
                  </td>
                  <td className="num px-4 py-3 text-right text-bone-dim">{s.laps}</td>
                  <td className={`num px-4 py-3 text-right ${s.best_ms === trackBest ? "text-best" : ""}`}>{lapTime(s.best_ms)}</td>
                  <td className="px-4 py-3 text-right">
                    {s.warnings > 0 ? <Chip tone="warn">{s.warnings} QC</Chip> : <span className="text-mute transition-colors group-hover:text-signal">→</span>}
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
  const { data, error } = useApi<SessionListItem[]>("/sessions");
  const groups = useMemo(() => {
    const byTrack = new Map<string, SessionListItem[]>();
    for (const s of data ?? []) byTrack.set(s.track, [...(byTrack.get(s.track) ?? []), s]);
    return [...byTrack.entries()];
  }, [data]);

  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock />;

  const laps = data.reduce((n, s) => n + s.laps, 0);
  const km = data.reduce((n, s) => n + (s.laps * s.length_m) / 1000, 0);

  return (
    <>
      <PageTitle eyebrow="Garage" title="Sessions" />
      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile index={0} label="Sessions" value={data.length} />
            <StatTile index={1} label="Laps" value={laps} />
            <StatTile index={2} label="Distance" value={`${Math.round(km).toLocaleString("en-GB")} km`} />
            <StatTile index={3} label="Circuits" value={groups.length} />
          </div>
          <div className="space-y-6">
            {groups.map(([slug, sessions], i) => (
              <TrackGroup key={slug} slug={slug} sessions={sessions} index={i} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
