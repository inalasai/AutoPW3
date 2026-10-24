import type { NodeId, SpokeId } from './flow-model';

/**
 * Where the five nodes sit on the canvas, as a pure function of its size. The hub is in the middle; Solar above,
 * Battery below, Grid on the left and Home on the right. Positions are fractions of the canvas, so the same
 * layout serves a phone (tall) and a desktop (wide). Nothing here touches the DOM.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface NodeBox extends Point {
  readonly r: number;
}

/** A spoke's straight path from its node's edge to the hub's edge. Orientation is always node to hub. */
export interface SpokePath {
  readonly start: Point;
  readonly end: Point;
  readonly length: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly nodes: Readonly<Record<NodeId, NodeBox>>;
  readonly paths: Readonly<Record<SpokeId, SpokePath>>;
}

const POSITIONS: Readonly<Record<SpokeId, Point>> = {
  SOLAR: { x: 0.5, y: 0.17 },
  GRID: { x: 0.15, y: 0.5 },
  HOME: { x: 0.85, y: 0.5 },
  BATTERY: { x: 0.5, y: 0.83 },
};

const MIN_NODE_RADIUS = 20;
const MAX_NODE_RADIUS = 46;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function edgePoint(from: NodeBox, to: NodeBox, radius: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: from.x, y: from.y };
  return { x: from.x + (dx / length) * radius, y: from.y + (dy / length) * radius };
}

/** The layout for a canvas of `width` by `height` CSS pixels. Non-positive sizes give a zero-sized layout. */
export function computeLayout(width: number, height: number): Layout {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const nodeRadius = clamp(Math.min(w, h) * 0.085, MIN_NODE_RADIUS, MAX_NODE_RADIUS);
  const hubRadius = nodeRadius * 0.85;
  const hub: NodeBox = { x: w / 2, y: h / 2, r: hubRadius };
  const box = (id: SpokeId): NodeBox => {
    const p = POSITIONS[id];
    return { x: p.x * w, y: p.y * h, r: nodeRadius };
  };
  const nodes: Record<NodeId, NodeBox> = {
    HUB: hub,
    SOLAR: box('SOLAR'),
    BATTERY: box('BATTERY'),
    GRID: box('GRID'),
    HOME: box('HOME'),
  };
  const pathFor = (id: SpokeId): SpokePath => {
    const node = nodes[id];
    const start = edgePoint(node, hub, node.r + 4);
    const end = edgePoint(hub, node, hub.r + 4);
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  };
  return {
    width: w,
    height: h,
    nodes,
    paths: {
      SOLAR: pathFor('SOLAR'),
      BATTERY: pathFor('BATTERY'),
      GRID: pathFor('GRID'),
      HOME: pathFor('HOME'),
    },
  };
}

/** The point a fraction `t` (0 to 1) along a spoke path, from node to hub. `t` is clamped. */
export function pointOnPath(path: SpokePath, t: number): Point {
  const f = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  return {
    x: path.start.x + (path.end.x - path.start.x) * f,
    y: path.start.y + (path.end.y - path.start.y) * f,
  };
}
