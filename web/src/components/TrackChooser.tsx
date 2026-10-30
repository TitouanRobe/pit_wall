import { useEffect, useMemo } from "react";
import type { SessionListItem, TrackMap } from "../api";
import { distance } from "../lib/format";
import { useApi } from "../lib/useApi";
import { TrackOutline } from "./TrackMap";
import { ErrorBlock, LoadingBlock, PageTitle } from "./ui";

function TrackCard({ session, action, onPick }: { session: SessionListItem; action: string; onPick: () => void }) {
  const map = useApi<TrackMap>(`/tracks/${session.track}/map`);
  return (
    <button onClick={onPick} className="panel group flex items-center gap-5 p-5 text-left transition-colors hover:border-signal/50">
      <div className="h-24 w-24 shrink-0">{map.data && <TrackOutline map={map.data} className="h-full w-full" />}</div>
      <div>
        <div className="font-display text-xl font-semibold uppercase leading-tight">{session.track_name}</div>
        <div className="mt-1 text-[13px] text-bone-dim">{distance(session.length_m)}</div>
        <div className="label mt-3 transition-colors group-hover:!text-signal">{action} →</div>
      </div>
    </button>
  );
}

export function TrackChooser({
  eyebrow,
  action,
  emptyText,
  autoPickSingle = false,
  onPick,
}: {
  eyebrow: string;
  action: string;
  emptyText: string;
  autoPickSingle?: boolean;
  onPick: (slug: string) => void;
}) {
  const { data, error } = useApi<SessionListItem[]>("/sessions");
  const tracks = useMemo(() => {
    const seen = new Map<string, SessionListItem>();
    for (const s of data ?? []) if (!seen.has(s.track)) seen.set(s.track, s);
    return [...seen.values()];
  }, [data]);

  const single = autoPickSingle && tracks.length === 1 ? tracks[0].track : null;
  useEffect(() => {
    if (single) onPick(single);
  }, [single]);

  if (error) return <ErrorBlock message={error} />;
  if (!data || single) return <LoadingBlock />;

  return (
    <>
      <PageTitle eyebrow={eyebrow} title="Pick a circuit" />
      {tracks.length === 0 ? (
        <p className="text-bone-dim">{emptyText}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tracks.map((t) => (
            <TrackCard key={t.track} session={t} action={action} onPick={() => onPick(t.track)} />
          ))}
        </div>
      )}
    </>
  );
}
