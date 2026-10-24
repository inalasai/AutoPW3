import { memo, useEffect, useRef } from 'react';
import { cx } from '../../lib/cx';
import { SPOKE_IDS } from './flow-model';
import type { FlowModel, SpokeId } from './flow-model';
import { computeLayout } from './layout';
import { advancePhase } from './particles';
import { drawScene, readPalette } from './renderer';

export interface FlowCanvasProps {
  model: FlowModel;
  /**
   * Move particles. False for reduced motion and for effects switched off: the frame is then drawn once, with
   * direction arrows and no particles, and no animation frame is ever requested.
   */
  animate: boolean;
  className?: string;
}

function hasMotion(model: FlowModel): boolean {
  return SPOKE_IDS.some((id) => model.spokes[id].animated && model.spokes[id].particleCount > 0);
}

/**
 * The canvas for the Live View. Decorative: the numbers and a text summary are real page text beside it, so the
 * canvas is hidden from assistive technology.
 *
 * Animation state (particle phases, timestamps, the animation-frame handle, the canvas size) lives in the closure
 * of one effect, not in React state, so a frame never causes a React render. The latest model and `animate`
 * arrive through refs. The loop runs only while something is moving, the tab is visible and `animate` is true;
 * it is cancelled on unmount and whenever those stop holding.
 */
export const FlowCanvas = memo(function FlowCanvas({ model, animate, className }: FlowCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef(model);
  const animateRef = useRef(animate);
  const syncRef = useRef<(() => void) | null>(null);

  // New data or a motion preference change: update the refs and let the loop decide what to do.
  useEffect(() => {
    modelRef.current = model;
    animateRef.current = animate;
    syncRef.current?.();
  }, [model, animate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const ctx = canvas.getContext('2d');
    // No 2D context (very old browsers, some test environments): the readouts and summary still work.
    if (ctx === null || ctx === undefined) return undefined;

    const palette = readPalette(document.documentElement);
    const phases: Record<SpokeId, number> = { SOLAR: 0, BATTERY: 0, GRID: 0, HOME: 0 };
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frameHandle: number | null = null;
    let lastTime: number | null = null;

    /** Re-measure the canvas box and device pixel ratio; resize the bitmap when either changed. */
    const measure = (): void => {
      const box = canvas.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      const r = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      if (w === width && h === height && r === ratio) return;
      width = w;
      height = h;
      ratio = r;
      canvas.width = Math.max(1, Math.round(w * r));
      canvas.height = Math.max(1, Math.round(h * r));
    };

    const draw = (showParticles: boolean): void => {
      if (width <= 0 || height <= 0) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawScene(ctx, {
        layout: computeLayout(width, height),
        model: modelRef.current,
        phases,
        showParticles,
        palette,
      });
    };

    const shouldRun = (): boolean =>
      animateRef.current && hasMotion(modelRef.current) && document.visibilityState === 'visible';

    const frame = (time: number): void => {
      frameHandle = null;
      measure();
      const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
      lastTime = time;
      const layout = computeLayout(width, height);
      const current = modelRef.current;
      for (const id of SPOKE_IDS) {
        const spoke = current.spokes[id];
        if (spoke.animated) {
          phases[id] = advancePhase(
            phases[id],
            spoke.speedPxPerSecond,
            layout.paths[id].length,
            dt,
          );
        }
      }
      draw(animateRef.current);
      if (shouldRun()) frameHandle = window.requestAnimationFrame(frame);
    };

    /** Start or stop the loop to match the current state, and redraw when it is not running. */
    const sync = (): void => {
      if (shouldRun()) {
        if (frameHandle === null) {
          lastTime = null;
          frameHandle = window.requestAnimationFrame(frame);
        }
        return;
      }
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
      measure();
      draw(false);
    };
    syncRef.current = sync;

    const onResize = (): void => {
      measure();
      // A running loop redraws on its next frame; a stopped one needs the still frame redrawn now.
      if (frameHandle === null) draw(false);
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(onResize);
      observer.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }
    // Browser zoom and moving the window to another screen change the pixel ratio without resizing the box.
    let ratioQuery: MediaQueryList | null = null;
    const watchRatio = (): void => {
      ratioQuery?.removeEventListener('change', onRatio);
      if (typeof window.matchMedia !== 'function') return;
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      ratioQuery.addEventListener('change', onRatio);
    };
    function onRatio(): void {
      onResize();
      watchRatio();
    }
    watchRatio();
    document.addEventListener('visibilitychange', sync);

    measure();
    sync();

    return () => {
      syncRef.current = null;
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      ratioQuery?.removeEventListener('change', onRatio);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cx('relative aspect-[10/11] w-full min-[521px]:aspect-[100/56]', className)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
});
