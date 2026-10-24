import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowCanvas } from './FlowCanvas';
import { createFakeContext } from './fake-canvas';
import type { FakeContext } from './fake-canvas';
import { buildFlowModel } from './flow-model';
import type { FlowSample } from './flow-model';

function modelOf(overrides: Partial<FlowSample> = {}, freshness: 'FRESH' | 'STALE' = 'FRESH') {
  return buildFlowModel({
    sample: {
      solarPowerW: 3800,
      batteryPowerW: -2400,
      gridPowerW: -700,
      loadPowerW: 700,
      batterySocPercent: 58,
      quality: 'OK',
      ...overrides,
    },
    freshness,
  });
}

const MOVING = modelOf();
const IDLE = modelOf({ solarPowerW: 0, batteryPowerW: 0, gridPowerW: 0, loadPowerW: 0 });

let fake: FakeContext;
let frames: Map<number, FrameRequestCallback>;
let nextHandle: number;
let requestFrame: ReturnType<typeof vi.fn>;
let cancelFrame: ReturnType<typeof vi.fn>;
let visibility: 'visible' | 'hidden';
let resizeCallbacks: Array<() => void>;
let size: { width: number; height: number };

function setVisibility(value: 'visible' | 'hidden'): void {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Run the oldest pending animation frame at `time` milliseconds. */
function runFrame(time: number): void {
  const [handle, callback] = [...frames.entries()][0] ?? [];
  if (handle === undefined || callback === undefined) throw new Error('no frame is pending');
  frames.delete(handle);
  act(() => {
    callback(time);
  });
}

beforeEach(() => {
  fake = createFakeContext();
  frames = new Map();
  nextHandle = 1;
  visibility = 'visible';
  resizeCallbacks = [];
  size = { width: 400, height: 440 };
  requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    frames.set(handle, callback);
    return handle;
  });
  cancelFrame = vi.fn((handle: number) => {
    frames.delete(handle);
  });
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    },
  );
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fake.ctx as unknown as RenderingContext,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height }) as DOMRect,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

describe('FlowCanvas', () => {
  it('is hidden from assistive technology: the numbers and a summary are text beside it', () => {
    const { container } = render(<FlowCanvas model={MOVING} animate />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('runs one animation loop while data is live and moving, and redraws on every frame', () => {
    render(<FlowCanvas model={MOVING} animate />);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    runFrame(1000);
    runFrame(1016);
    runFrame(1032);
    // One request per frame, never two at once.
    expect(requestFrame).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(1);
    expect(fake.count('clearRect')).toBe(3);
  });

  it('cancels the pending animation frame and every listener on unmount', () => {
    const { unmount } = render(<FlowCanvas model={MOVING} animate />);
    const pending = [...frames.keys()];
    expect(pending).toHaveLength(1);
    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(pending[0]);
    expect(frames.size).toBe(0);
    // A change after unmount starts nothing.
    const before = requestFrame.mock.calls.length;
    setVisibility('hidden');
    setVisibility('visible');
    expect(requestFrame.mock.calls.length).toBe(before);
  });

  it('draws one still frame and never requests a frame when animation is off (reduced motion, effects off)', () => {
    render(<FlowCanvas model={MOVING} animate={false} />);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(fake.count('clearRect')).toBe(1);
    // Arrows are drawn (4 active spokes); no particles: a rotate per arrowhead and nothing else moves.
    expect(fake.count('rotate')).toBe(4);
  });

  it('stops the loop when animation is switched off and starts it again when switched on', () => {
    const { rerender } = render(<FlowCanvas model={MOVING} animate />);
    expect(frames.size).toBe(1);
    rerender(<FlowCanvas model={MOVING} animate={false} />);
    expect(frames.size).toBe(0);
    expect(cancelFrame).toHaveBeenCalled();
    rerender(<FlowCanvas model={MOVING} animate />);
    expect(frames.size).toBe(1);
  });

  it('does not animate stale data or idle spokes, but draws them', () => {
    render(<FlowCanvas model={modelOf({}, 'STALE')} animate />);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(fake.count('clearRect')).toBe(1);
    render(<FlowCanvas model={IDLE} animate />);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('stops requesting frames when the data stops moving', () => {
    const { rerender } = render(<FlowCanvas model={MOVING} animate />);
    runFrame(1000);
    rerender(<FlowCanvas model={IDLE} animate />);
    expect(frames.size).toBe(0);
    const draws = fake.count('clearRect');
    // The still frame was redrawn for the new model.
    expect(draws).toBeGreaterThanOrEqual(2);
  });

  it('pauses while the tab is hidden and resumes when it is shown', () => {
    render(<FlowCanvas model={MOVING} animate />);
    expect(frames.size).toBe(1);
    setVisibility('hidden');
    expect(frames.size).toBe(0);
    setVisibility('visible');
    expect(frames.size).toBe(1);
  });

  it('does not start a loop when the tab is hidden at the start', () => {
    visibility = 'hidden';
    render(<FlowCanvas model={MOVING} animate />);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('sizes the bitmap by the device pixel ratio and scales drawing to CSS pixels', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    size = { width: 300, height: 330 };
    const { container } = render(<FlowCanvas model={MOVING} animate={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(600);
    expect(canvas?.height).toBe(660);
    expect(fake.calls.find((call) => call.name === 'setTransform')?.args).toEqual([
      2, 0, 0, 2, 0, 0,
    ]);
    expect(fake.calls.find((call) => call.name === 'clearRect')?.args).toEqual([0, 0, 300, 330]);
  });

  it('follows a resize of the canvas box', () => {
    const { container } = render(<FlowCanvas model={MOVING} animate={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas?.width).toBe(400);
    size = { width: 800, height: 448 };
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(canvas?.width).toBe(800);
    expect(canvas?.height).toBe(448);
    expect(fake.calls.filter((call) => call.name === 'clearRect').at(-1)?.args).toEqual([
      0, 0, 800, 448,
    ]);
  });

  it('draws nothing while the canvas has no size yet', () => {
    size = { width: 0, height: 0 };
    render(<FlowCanvas model={MOVING} animate={false} />);
    expect(fake.count('clearRect')).toBe(0);
  });

  it('survives a browser with no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { unmount } = render(<FlowCanvas model={MOVING} animate />);
    expect(requestFrame).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps phases bounded and survives a long pause between frames', () => {
    render(<FlowCanvas model={MOVING} animate />);
    runFrame(0);
    runFrame(10 * 60 * 1000);
    runFrame(10 * 60 * 1000 + 16);
    const arcs = fake.calls.filter((call) => call.name === 'arc');
    for (const call of arcs) {
      for (const value of call.args) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
