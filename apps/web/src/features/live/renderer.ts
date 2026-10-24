import { NODE_TITLES, SPOKE_IDS } from './flow-model';
import type { FlowModel, NodeId, SpokeFlow, SpokeId } from './flow-model';
import { pointOnPath } from './layout';
import type { Layout, NodeBox, Point } from './layout';
import { particleFractions } from './particles';

/**
 * The canvas renderer. It only draws: lines, arrowheads, particles and node icons from a `Scene`. Every decision
 * about direction, size, animation or unknown data was already made by the flow model; this file reads those
 * results and never recomputes them. The numeric readings are not drawn here (they are real text on the page, so
 * they stay readable and accessible without the canvas).
 */

export interface Palette {
  readonly solar: string;
  readonly battery: string;
  readonly grid: string;
  readonly gridInk: string;
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly panel: string;
  readonly select: string;
  readonly font: string;
}

/** The design tokens' values, used when the page has no custom properties (tests). */
export const DEFAULT_PALETTE: Palette = {
  solar: '#f59e0b',
  battery: '#10b981',
  grid: '#6366f1',
  gridInk: '#a5b4fc',
  ink: '#e2e8f0',
  muted: '#94a3b8',
  line: '#1e293b',
  panel: '#0f172a',
  select: '#06b6d4',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
};

/** Read the palette from the design tokens (CSS custom properties) so the canvas follows the theme. */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  return {
    solar: read('--color-solar', DEFAULT_PALETTE.solar),
    battery: read('--color-battery', DEFAULT_PALETTE.battery),
    grid: read('--color-grid', DEFAULT_PALETTE.grid),
    gridInk: read('--color-grid-ink', DEFAULT_PALETTE.gridInk),
    ink: read('--color-ink', DEFAULT_PALETTE.ink),
    muted: read('--color-ink-muted', DEFAULT_PALETTE.muted),
    line: read('--color-line', DEFAULT_PALETTE.line),
    panel: read('--color-panel', DEFAULT_PALETTE.panel),
    select: read('--color-select', DEFAULT_PALETTE.select),
    font: read('--font-sans', DEFAULT_PALETTE.font),
  };
}

export interface Scene {
  readonly layout: Layout;
  readonly model: FlowModel;
  /** Each spoke's particle phase, 0 to 1. Owned by the animation loop, never React state. */
  readonly phases: Readonly<Record<SpokeId, number>>;
  /** Draw moving particles. False for reduced motion, effects off and the still frame: arrows only. */
  readonly showParticles: boolean;
  readonly palette: Palette;
}

type Tone = { readonly stroke: string; readonly particle: string };

function toneOf(id: SpokeId, palette: Palette): Tone {
  switch (id) {
    case 'SOLAR':
      return { stroke: palette.solar, particle: palette.solar };
    case 'BATTERY':
      return { stroke: palette.battery, particle: palette.battery };
    case 'GRID':
      return { stroke: palette.grid, particle: palette.gridInk };
    case 'HOME':
      return { stroke: palette.ink, particle: palette.ink };
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  at: Point,
  towards: Point,
  size: number,
  color: string,
): void {
  const angle = Math.atan2(towards.y - at.y, towards.x - at.x);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.lineTo(-size * 0.7, -size * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawSpoke(ctx: CanvasRenderingContext2D, scene: Scene, id: SpokeId): void {
  const { layout, model, palette } = scene;
  const spoke: SpokeFlow = model.spokes[id];
  const path = layout.paths[id];
  const tone = toneOf(id, palette);
  const active = spoke.from !== null && spoke.to !== null;
  const live = model.data === 'LIVE';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(path.start.x, path.start.y);
  ctx.lineTo(path.end.x, path.end.y);
  if (spoke.kind === 'UNKNOWN') {
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = palette.muted;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
  } else if (!active) {
    ctx.setLineDash([]);
    ctx.strokeStyle = palette.line;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
  } else {
    // Active: a dotted line means the data is not live (stale or flagged), so it cannot be mistaken for live flow.
    ctx.setLineDash(live ? [] : [2, 6]);
    ctx.strokeStyle = tone.stroke;
    ctx.globalAlpha = live ? 0.55 : 0.5;
    ctx.lineWidth = 2 + spoke.level * 2;
  }
  ctx.stroke();
  ctx.restore();

  if (!active || spoke.from === null) return;

  // Direction arrowhead at the middle, always drawn for an active spoke, animated or not.
  const towardHub = spoke.to === 'HUB';
  const mid = pointOnPath(path, 0.5);
  const head = towardHub ? path.end : path.start;
  ctx.save();
  ctx.globalAlpha = live ? 1 : 0.7;
  drawArrowhead(ctx, mid, head, 7 + spoke.level * 3, tone.stroke);
  ctx.restore();

  if (scene.showParticles && spoke.animated && spoke.particleCount > 0) {
    ctx.save();
    ctx.fillStyle = tone.particle;
    for (const t of particleFractions(scene.phases[id], spoke.particleCount)) {
      const p = pointOnPath(path, towardHub ? t : 1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5 + spoke.level * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Small glyph for a node, drawn inside its circle with strokes only. `u` is a unit length from the radius. */
function drawIcon(ctx: CanvasRenderingContext2D, id: NodeId, box: NodeBox, color: string): void {
  const u = box.r / 10;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, u * 0.7);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (id) {
    case 'SOLAR': {
      ctx.arc(0, 0, 2.6 * u, 0, Math.PI * 2);
      for (let i = 0; i < 8; i += 1) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(Math.cos(a) * 4 * u, Math.sin(a) * 4 * u);
        ctx.lineTo(Math.cos(a) * 5.6 * u, Math.sin(a) * 5.6 * u);
      }
      break;
    }
    case 'BATTERY': {
      ctx.rect(-3 * u, -4.6 * u, 6 * u, 9.6 * u);
      ctx.moveTo(-1.2 * u, -4.6 * u);
      ctx.lineTo(-1.2 * u, -6 * u);
      ctx.lineTo(1.2 * u, -6 * u);
      ctx.lineTo(1.2 * u, -4.6 * u);
      break;
    }
    case 'GRID': {
      ctx.moveTo(1.4 * u, -5.5 * u);
      ctx.lineTo(-3 * u, 1 * u);
      ctx.lineTo(0, 1 * u);
      ctx.lineTo(-1.4 * u, 5.5 * u);
      ctx.lineTo(3 * u, -1 * u);
      ctx.lineTo(0, -1 * u);
      ctx.closePath();
      break;
    }
    case 'HOME': {
      ctx.moveTo(-5 * u, -0.5 * u);
      ctx.lineTo(0, -5.4 * u);
      ctx.lineTo(5 * u, -0.5 * u);
      ctx.moveTo(-3.6 * u, -1.8 * u);
      ctx.lineTo(-3.6 * u, 4.6 * u);
      ctx.lineTo(3.6 * u, 4.6 * u);
      ctx.lineTo(3.6 * u, -1.8 * u);
      break;
    }
    case 'HUB': {
      ctx.arc(0, 0, 1.6 * u, 0, Math.PI * 2);
      break;
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawNode(ctx: CanvasRenderingContext2D, scene: Scene, id: NodeId): void {
  const { layout, model, palette } = scene;
  const box = layout.nodes[id];
  const ring = id === 'HUB' ? palette.select : toneOf(id, palette).stroke;
  const unknown = id !== 'HUB' && model.spokes[id].kind === 'UNKNOWN';

  ctx.save();
  ctx.beginPath();
  ctx.arc(box.x, box.y, box.r, 0, Math.PI * 2);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.setLineDash(unknown ? [3, 5] : []);
  ctx.lineWidth = 2;
  ctx.strokeStyle = unknown ? palette.muted : ring;
  ctx.stroke();
  ctx.restore();

  if (id === 'HUB') {
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.font = `600 ${Math.max(10, Math.round(box.r * 0.38))}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const line = Math.max(10, Math.round(box.r * 0.38)) * 0.55;
    ctx.fillText('Core', box.x, box.y - line);
    ctx.fillText('Hub', box.x, box.y + line);
    ctx.restore();
    return;
  }

  drawIcon(ctx, id, box, unknown ? palette.muted : ring);

  ctx.save();
  ctx.fillStyle = palette.ink;
  ctx.font = `600 ${Math.max(11, Math.round(box.r * 0.36))}px ${palette.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = id === 'SOLAR' ? 'bottom' : 'top';
  const offset = box.r + 6;
  ctx.fillText(NODE_TITLES[id], box.x, id === 'SOLAR' ? box.y - offset : box.y + offset);
  ctx.restore();
}

/**
 * Draw one frame. Assumes the context's transform already maps CSS pixels (the wrapper applies the device pixel
 * ratio), so everything here is in CSS pixels. The frame is cleared first.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { layout } = scene;
  ctx.clearRect(0, 0, layout.width, layout.height);
  for (const id of SPOKE_IDS) drawSpoke(ctx, scene, id);
  for (const id of SPOKE_IDS) drawNode(ctx, scene, id);
  drawNode(ctx, scene, 'HUB');
}
