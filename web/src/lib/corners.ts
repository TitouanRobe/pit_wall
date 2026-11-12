import type { Corner, Trace } from "../api";
import { nearestIndex } from "./cursor";

export type Direction = "left" | "right";

const HEADING_SPAN_M = 15;

export function cornerDirections(corners: Corner[], trace: Trace): Direction[] {
  const point = (i: number): [number, number] => [trace.pos_x[i], -trace.pos_z[i]];
  const heading = (from: number, to: number): [number, number] => {
    const a = point(nearestIndex(trace.s, from));
    const b = point(nearestIndex(trace.s, to));
    return [b[0] - a[0], b[1] - a[1]];
  };
  const out: Direction[] = [];
  for (const c of corners) {
    const [x1, y1] = heading(c.s_start, c.s_start + HEADING_SPAN_M);
    const [x2, y2] = heading(c.s_end - HEADING_SPAN_M, c.s_end);
    out[c.index] = x1 * y2 - y1 * x2 > 0 ? "right" : "left";
  }
  return out;
}
