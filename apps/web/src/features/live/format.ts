import { NODE_TITLES, SPOKE_IDS, SPOKE_KIND_LABELS } from './flow-model';
import type { BatteryDisplay, FlowModel, SpokeFlow } from './flow-model';

/**
 * Text for the Live View: kilowatts, ages and the sentence read out by the screen-reader live region.
 * Formatting uses integer arithmetic only (no `toFixed`), so a reading prints the same everywhere.
 */

/** Kilowatts with two decimals from watts, as an unsigned magnitude: `3800` is "3.80". `null` for no value. */
export function formatKilowatts(watts: number | null): string | null {
  if (watts === null || !Number.isFinite(watts)) return null;
  const hundredths = Math.round(Math.abs(watts) / 10);
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  return `${whole}.${fraction < 10 ? '0' : ''}${fraction}`;
}

/**
 * A percentage with no decimals for the gauge text, or `null`. It rounds down, so the number never reads higher than
 * the real level and always agrees with the state word: 14.9 is shown as 14 and is Low, never "15" and Low.
 */
export function formatPercent(percent: number | null): string | null {
  return percent === null || !Number.isFinite(percent) ? null : String(Math.floor(percent));
}

/** "just now", "12 s ago", "3 min ago", "2 h ago", "4 d ago". `null` age gives "no timestamp". */
export function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 0) return 'no timestamp';
  if (ageSeconds < 5) return 'just now';
  if (ageSeconds < 60) return `${Math.floor(ageSeconds)} s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Time of day for an instant in a time zone (the browser's when none is given): "13:05:09". */
export function formatClockTime(instant: string, timeZone?: string): string | null {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      ...(timeZone !== undefined ? { timeZone } : {}),
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

function spokePhrase(spoke: SpokeFlow, noun: string): string {
  const magnitude = formatKilowatts(spoke.magnitudeW);
  if (magnitude === null) return `${noun} no data`;
  if (spoke.kind === 'IDLE') return `${noun} idle, ${magnitude} kilowatts`;
  return `${noun} ${SPOKE_KIND_LABELS[spoke.kind].toLowerCase()} ${magnitude} kilowatts`;
}

function batteryPhrase(battery: BatteryDisplay): string {
  const percent = formatPercent(battery.percent);
  if (percent === null) return 'battery level unknown';
  switch (battery.caveat) {
    case 'STALE_READING':
      return `battery level ${percent} percent, stale`;
    case 'SUSPECT_READING':
      return `battery level ${percent} percent, unverified`;
    default:
      return `battery level ${percent} percent${
        battery.state === 'CRITICAL' ? ', critically low' : battery.state === 'LOW' ? ', low' : ''
      }`;
  }
}

/**
 * One sentence per node, for the polite live region: what each part of the site is doing and how much, then the
 * battery level, prefixed with a warning when the data is not live. Never says a number it does not have.
 */
export function summariseFlows(model: FlowModel): string {
  if (model.data === 'NONE') return 'No current energy data.';
  const prefix =
    model.data === 'STALE'
      ? 'Data is stale, showing the last reading. '
      : model.data === 'SUSPECT'
        ? 'This reading was flagged as unreliable. '
        : '';
  const parts = SPOKE_IDS.map((id) => `${spokePhrase(model.spokes[id], NODE_TITLES[id])}.`);
  return `${prefix}${parts.join(' ')} ${capitalise(batteryPhrase(model.battery))}.`;
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
