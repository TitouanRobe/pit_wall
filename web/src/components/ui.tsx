import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function PageTitle({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
      <div>
        {eyebrow && <div className="label mb-2">{eyebrow}</div>}
        <h1 className="font-display text-4xl font-semibold uppercase leading-none tracking-[0.02em] sm:text-5xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
  index = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      className="panel relative overflow-hidden px-5 py-4"
    >
      {accent && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />}
      <div className="label">{label}</div>
      <div className="mt-2 font-display text-[28px] font-semibold sm:text-[34px] leading-none tracking-[0.01em]">{value}</div>
      {hint && <div className="mt-2 text-[13px] text-bone-dim">{hint}</div>}
    </motion.div>
  );
}

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "warn" | "signal" }) {
  const tones = {
    default: "border-line-strong text-bone-dim",
    warn: "border-loss/40 text-loss",
    signal: "border-signal/40 text-signal",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-[3px] text-[12px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="font-display text-lg font-semibold uppercase tracking-[0.1em] text-bone">{children}</h2>
      {aside && <div className="text-[13px] text-mute">{aside}</div>}
    </div>
  );
}

export function LoadingBlock({ height = 240 }: { height?: number }) {
  return (
    <div className="panel grain flex items-center justify-center" style={{ height }}>
      <span className="label animate-pulse">Loading telemetry</span>
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="panel border-loss/40 px-5 py-4 text-[14px] text-bone-dim">
      <span className="label !text-loss">Error</span>
      <p className="mt-1">{message}</p>
    </div>
  );
}

export function SeriesSwatch({ color, label }: { color: string; label: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-[3px] w-4 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
