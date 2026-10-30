import { Select } from "@mantine/core";
import { ResponsiveHeatMap } from "@nivo/heatmap";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Progression } from "../api";
import { SessionLineChart, type SessionPoint } from "../components/SessionLineChart";
import { TrackChooser } from "../components/TrackChooser";
import { Chip, ErrorBlock, LoadingBlock, PageTitle, SectionTitle, SeriesSwatch, StatTile } from "../components/ui";
import { dateTime, lapTime, sessionType, shortDate, shortTime, signed } from "../lib/format";
import { ramp, rampLegend } from "../lib/ramp";
import { useApi } from "../lib/useApi";
import { nivoTheme, palette } from "../theme";

const HEATMAP_ROW_PX = 34;
const HEATMAP_COLUMN_PX = 64;
const HEATMAP_LABELS_MAX_SESSIONS = 10;
const FOCUS_CARDS = 3;
const NEGLIGIBLE_GAP_S = 0.005;

function ProgressPicker() {
  const [, setParams] = useSearchParams();
  return (
    <TrackChooser
      eyebrow="Progression"
      action="See progression"
      emptyText="Record a few sessions first. Progression compares your laps on the same circuit over time."
      autoPickSingle
      onPick={(slug) => setParams({ track: slug }, { replace: true })}
    />
  );
}

function Hint({ children }: { children: string }) {
  return <div className="flex h-full items-center justify-center text-[14px] text-mute">{children}</div>;
}

function ProgressView({ slug, car }: { slug: string; car: string | null }) {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, error, loading } = useApi<Progression>(`/tracks/${slug}/progression${car ? `?car=${encodeURIComponent(car)}` : ""}`);
  const [picked, setPicked] = useState<number | null>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const { sessions, corners, best_ever_s: bestEver } = data;
    const perDay = new Map<string, number>();
    for (const s of sessions) perDay.set(shortDate(s.started_at), (perDay.get(shortDate(s.started_at)) ?? 0) + 1);
    const points: SessionPoint[] = sessions.map((s) => ({
      id: String(s.session_id),
      tick: (perDay.get(shortDate(s.started_at)) ?? 0) > 1 ? `${shortDate(s.started_at)} ${shortTime(s.started_at)}` : shortDate(s.started_at),
      title: `${dateTime(s.started_at)} · ${sessionType(s.session_type)}`,
    }));
    const gaps = corners.map((_, i) => sessions.map((s) => s.corners[i].median_s - bestEver[i]));
    const maxGap = Math.max(0.05, ...gaps.flat());
    const heat = corners.map((c, i) => ({
      id: c.name,
      data: sessions.map((s, j) => ({ x: String(s.session_id), y: gaps[i][j] })),
    }));
    const byFocus = [...data.focus].sort((a, b) => b.gap_s - a.gap_s);
    return { points, heat, maxGap, gaps, byFocus, latest: sessions[sessions.length - 1], first: sessions[0] };
  }, [data]);

  if (error) return <ErrorBlock message={error} />;
  if (!data || !view) return <LoadingBlock height={520} />;

  const { sessions, corners, summary } = data;
  const { points, heat, maxGap, byFocus, latest, first } = view;
  const selected = picked ?? byFocus[0]?.index ?? 0;
  const corner = corners[selected];
  const cornerStats = latest.corners[selected];
  const change = sessions.length > 1 && summary.first_best_ms != null && summary.latest_best_ms != null
    ? (summary.latest_best_ms - summary.first_best_ms) / 1000
    : null;
  const spreadTrend = first.stdev_ms != null && latest.stdev_ms != null && sessions.length > 1 ? (latest.stdev_ms - first.stdev_ms) / 1000 : null;
  const heatWidth = Math.max(560, sessions.length * HEATMAP_COLUMN_PX + 120);

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }} className="transition-opacity">
      <div className="mb-3 text-[13px] text-mute">
        <Link to="/progress" className="hover:text-bone">Progression</Link>
        <span className="mx-2">/</span>
        <span className="text-bone-dim">{data.track_name}</span>
      </div>
      <PageTitle eyebrow="Progression" title={data.track_name}>
        {data.cars.length > 1 ? (
          <Select
            aria-label="Car"
            data={data.cars.map((c) => ({ value: c.slug, label: `${c.name} (${c.sessions})` }))}
            value={data.car}
            onChange={(v) => v && setParams({ track: slug, car: v })}
            allowDeselect={false}
            w={260}
          />
        ) : (
          <Chip>{sessions[0]?.car_name}</Chip>
        )}
      </PageTitle>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label="Best lap" accent={palette.best} value={<span className="num">{lapTime(summary.best_ms)}</span>} />
        <StatTile
          index={1}
          label="Change in best lap"
          value={
            <span className="num" style={{ color: change == null ? undefined : change < 0 ? palette.gain : palette.loss }}>
              {change == null ? "-" : `${signed(change)} s`}
            </span>
          }
          hint={change == null ? "Needs a second session" : "latest session against the first"}
        />
        <StatTile
          index={2}
          label="Consistency"
          value={<span className="num">{latest.stdev_ms != null ? `σ ${(latest.stdev_ms / 1000).toFixed(3)}` : "-"}</span>}
          hint={spreadTrend == null ? `${latest.laps} clean laps in the latest session` : `${signed(spreadTrend)} s against the first session`}
        />
        <StatTile
          index={3}
          label="Sessions"
          value={<span className="num">{summary.sessions}</span>}
          hint={summary.span_days > 0 ? `over ${summary.span_days} days` : "all on the same day"}
        />
      </div>

      <div className="panel mb-8 p-5">
        <SectionTitle
          aside={
            <span className="flex gap-4">
              <SeriesSwatch color={palette.best} label="Best lap" />
              <SeriesSwatch color={palette.boneDim} label="Median clean lap" />
            </span>
          }
        >
          Lap time per session
        </SectionTitle>
        <div className="h-[280px]">
          {sessions.length < 2 ? (
            <Hint>Record a second session on this circuit to see the trend.</Hint>
          ) : (
            <SessionLineChart
              points={points}
              series={[
                { id: "best", label: "Best lap", color: palette.best, values: sessions.map((s) => s.best_ms) },
                { id: "median", label: "Median clean lap", color: palette.boneDim, values: sessions.map((s) => s.median_ms) },
              ]}
              format={lapTime}
              axisFormat={(v) => lapTime(v).slice(0, -2)}
            />
          )}
        </div>
      </div>

      <SectionTitle aside="Click a cell to open that corner">Where the time is lost</SectionTitle>
      <div className="panel mb-3 overflow-x-auto p-4">
        <div style={{ minWidth: heatWidth, height: corners.length * HEATMAP_ROW_PX + 56 }}>
          <ResponsiveHeatMap
            data={heat}
            margin={{ top: 40, right: 8, bottom: 4, left: 48 }}
            theme={nivoTheme}
            colors={(cell) => ramp((cell.value ?? 0) / maxGap)}
            emptyColor={palette.ink800}
            borderRadius={3}
            borderWidth={2}
            borderColor={palette.ink900}
            enableLabels={sessions.length <= HEATMAP_LABELS_MAX_SESSIONS}
            valueFormat={(v) => (v < NEGLIGIBLE_GAP_S ? "best" : v.toFixed(2))}
            labelTextColor={(cell) => ((cell.value ?? 0) / maxGap > 0.55 ? palette.ink950 : palette.bone)}
            axisTop={{ tickSize: 0, tickPadding: 8, format: (v) => points.find((p) => p.id === String(v))?.tick ?? "" }}
            axisLeft={{ tickSize: 0, tickPadding: 10 }}
            animate={false}
            hoverTarget="cell"
            onClick={(cell) => setPicked(corners.findIndex((c) => c.name === cell.serieId))}
            tooltip={({ cell }) => {
              const i = corners.findIndex((c) => c.name === cell.serieId);
              const j = sessions.findIndex((s) => String(s.session_id) === cell.data.x);
              const stats = sessions[j].corners[i];
              return (
                <div className="rounded-md border border-line-strong bg-ink-850 px-3 py-2 text-[12px] shadow-lg">
                  <div className="label mb-1.5">{cell.serieId} · {points[j].title}</div>
                  <div className="num text-bone">median {stats.median_s.toFixed(3)} s</div>
                  <div className="num text-bone-dim">best {stats.best_s.toFixed(3)} s</div>
                  <div className="num text-bone-dim">{stats.stdev_s != null ? `spread ±${stats.stdev_s.toFixed(3)} s` : "single lap"}</div>
                </div>
              );
            }}
            role="img"
            ariaLabel="Heat map of the time lost against your best, per corner and session"
          />
        </div>
      </div>
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-bone-dim">
        <span className="num whitespace-nowrap">0 s</span>
        <span className="h-[8px] w-40 rounded-full" style={{ background: rampLegend() }} aria-hidden />
        <span className="num whitespace-nowrap">+{maxGap.toFixed(2)} s</span>
        <span className="text-mute">median time lost against your best ever in that corner</span>
      </div>

      <SectionTitle aside="Latest session against your best ever">Where to work</SectionTitle>
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {byFocus.slice(0, FOCUS_CARDS).map((f, i) => (
          <motion.div
            key={f.index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            className="panel px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-bold uppercase tracking-[0.06em]">{f.name}</span>
              <span className="num text-[15px]" style={{ color: f.gap_s < NEGLIGIBLE_GAP_S ? palette.gain : palette.loss }}>
                {f.gap_s < NEGLIGIBLE_GAP_S ? "at your best" : `+${f.gap_s.toFixed(3)} s`}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-bone-dim">
              {f.spread_s != null ? `Spread of ±${f.spread_s.toFixed(3)} s over ${latest.laps} laps. ` : ""}
              {f.trend_s != null ? `${signed(f.trend_s)} s since the first session.` : "First session on this circuit."}
            </p>
            <button
              onClick={() => setPicked(f.index)}
              className="label mt-2 block transition-colors hover:!text-signal"
            >
              Show evolution →
            </button>
          </motion.div>
        ))}
      </div>

      <div className="panel mb-8 p-5">
        <SectionTitle
          aside={
            <span className="flex gap-4">
              <SeriesSwatch color={palette.best} label="Best" />
              <SeriesSwatch color={palette.boneDim} label="Median" />
            </span>
          }
        >
          {corner.name} evolution
        </SectionTitle>
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Corner">
          {corners.map((c) => (
            <button
              key={c.index}
              onClick={() => setPicked(c.index)}
              aria-pressed={c.index === selected}
              className={`rounded-[4px] border px-2.5 py-1 font-display text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                c.index === selected ? "border-signal/60 bg-signal/10 text-signal" : "border-line-strong text-bone-dim hover:text-bone"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          <div className="h-[260px]">
            {sessions.length < 2 ? (
              <Hint>Record a second session to see this corner evolve.</Hint>
            ) : (
              <SessionLineChart
                points={points}
                series={[
                  { id: "best", label: "Best", color: palette.best, values: sessions.map((s) => s.corners[selected].best_s) },
                  { id: "median", label: "Median", color: palette.boneDim, values: sessions.map((s) => s.corners[selected].median_s) },
                ]}
                format={(v) => `${v.toFixed(3)} s`}
                axisFormat={(v) => v.toFixed(2)}
                target={{ value: data.best_ever_s[selected], label: "best ever" }}
              />
            )}
          </div>
          <dl className="grid grid-cols-2 content-start gap-4 lg:grid-cols-1">
            {[
              ["Best ever", `${data.best_ever_s[selected].toFixed(3)} s`],
              ["Latest median", `${cornerStats.median_s.toFixed(3)} s`],
              ["Latest spread", cornerStats.stdev_s != null ? `±${cornerStats.stdev_s.toFixed(3)} s` : "-"],
              ["Apex speed on the reference", `${Math.round(corner.v_apex_kmh)} km/h`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="label">{k}</dt>
                <dd className="num mt-1 text-bone">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <SectionTitle aside="Select a row to open the session">Sessions</SectionTitle>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-[14px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label px-4 py-3">Date</th>
              <th className="label px-4 py-3">Type</th>
              <th className="label px-4 py-3 text-right">Clean laps</th>
              <th className="label px-4 py-3 text-right">Best</th>
              <th className="label px-4 py-3 text-right">Median</th>
              <th className="label px-4 py-3 text-right">Spread</th>
              <th className="label px-4 py-3 text-right">Track</th>
            </tr>
          </thead>
          <tbody>
            {[...sessions].reverse().map((s) => (
              <tr
                key={s.session_id}
                onClick={() => navigate(`/sessions/${s.session_id}`)}
                className="cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-ink-800"
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-bone-dim">{dateTime(s.started_at)}</td>
                <td className="px-4 py-2.5 text-bone-dim">{sessionType(s.session_type)}</td>
                <td className="num px-4 py-2.5 text-right text-bone-dim">{s.laps}</td>
                <td className={`num px-4 py-2.5 text-right ${s.best_ms === summary.best_ms ? "text-best" : ""}`}>{lapTime(s.best_ms)}</td>
                <td className="num px-4 py-2.5 text-right">{lapTime(s.median_ms)}</td>
                <td className="num px-4 py-2.5 text-right text-bone-dim">{s.stdev_ms != null ? `σ ${(s.stdev_ms / 1000).toFixed(3)}` : "-"}</td>
                <td className="num px-4 py-2.5 text-right text-bone-dim">{s.track_temp != null ? `${Math.round(s.track_temp)}°C` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const [params] = useSearchParams();
  const track = params.get("track");
  if (!track) return <ProgressPicker />;
  return <ProgressView slug={track} car={params.get("car")} />;
}
