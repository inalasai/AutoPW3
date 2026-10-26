import { useMemo, useState } from 'react';
import type { Tariff } from '@autopw3/shared';
import { localDay, roundToMinorUnit, splitIntervalAtBoundaries } from '@autopw3/domain';
import { GlassCard } from '../../components/ui/display';
import { Button } from '../../components/ui/Button';

export interface SchedulePreviewProps {
  tariff: Tariff;
}

interface SegmentDisplay {
  startMs: number;
  endMs: number;
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  widthPercent: number;
  rateText: string;
  label: string;
  source: string;
  isOk: boolean;
  problemCode?: string;
  colorClass: string;
}

export function SchedulePreview({ tariff }: SchedulePreviewProps) {
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to the tariff's effectiveFrom date or today
    return tariff.effectiveFrom || '2026-06-01';
  });

  const { segments, totalMinutes, dayDescription, isDstDay } = useMemo(() => {
    const timeZone = tariff.timezone;
    try {
      const { startMs, endMs, transitionMs, deltaMinutes } = localDay(selectedDate, timeZone);
      const totalMs = endMs - startMs;
      const totalMins = Math.round(totalMs / 60_000);
      const isDst = transitionMs !== null;
      const dayHours = totalMins / 60;

      const rawSegments = splitIntervalAtBoundaries(startMs, endMs, [tariff], tariff.direction);

      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const processed: SegmentDisplay[] = rawSegments.map((seg) => {
        const segDurationMins = Math.round((seg.endMs - seg.startMs) / 60_000);
        const width = (segDurationMins / totalMins) * 100;
        const startLocal = formatter.format(new Date(seg.startMs));
        // If endMs is exact day end, show 24:00 (or end time)
        const isEndExact = seg.endMs === endMs;
        const endLocal = isEndExact
          ? `${String(dayHours).padStart(2, '0')}:00`
          : formatter.format(new Date(seg.endMs));

        if (seg.result.ok) {
          const rate = seg.result.ratePerKwh;
          let color = 'bg-sky-500/30 border-sky-400 text-sky-200';
          const num = Number(rate);
          if (num < 0.2) {
            color = 'bg-emerald-500/30 border-emerald-400 text-emerald-200';
          } else if (num > 0.4) {
            color = 'bg-amber-500/30 border-amber-400 text-amber-200';
          }

          let formattedRate = `${rate} ${seg.result.currency}/kWh`;
          try {
            formattedRate = `${roundToMinorUnit(rate, seg.result.currency)} ${seg.result.currency}/kWh`;
          } catch {
            // Keep exact rate if currency unknown
          }

          return {
            startMs: seg.startMs,
            endMs: seg.endMs,
            startLocal,
            endLocal,
            durationMinutes: segDurationMins,
            widthPercent: width,
            rateText: formattedRate,
            label: seg.result.label ?? seg.result.source,
            source: seg.result.source,
            isOk: true,
            colorClass: color,
          };
        }

        return {
          startMs: seg.startMs,
          endMs: seg.endMs,
          startLocal,
          endLocal,
          durationMinutes: segDurationMins,
          widthPercent: width,
          rateText: 'No rate',
          label: seg.result.code,
          source: 'GAP',
          isOk: false,
          problemCode: seg.result.code,
          colorClass: 'bg-rose-500/30 border-rose-400 text-rose-200',
        };
      });

      let desc = `${dayHours} hours (${totalMins} mins)`;
      if (isDst) {
        desc += ` — Clock change (${deltaMinutes > 0 ? '+' : ''}${deltaMinutes}m)`;
      }

      return {
        segments: processed,
        totalMinutes: totalMins,
        dayDescription: desc,
        isDstDay: isDst,
      };
    } catch {
      return {
        segments: [],
        totalMinutes: 1440,
        dayDescription: 'Invalid date or timezone',
        isDstDay: false,
      };
    }
  }, [selectedDate, tariff]);

  return (
    <GlassCard title="Schedule Preview">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor="preview-date" className="font-medium text-ink-muted">
              Preview date:
            </label>
            <input
              id="preview-date"
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
              }}
              className="rounded-control border border-field-border bg-space-900 px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <span className="text-xs text-ink-muted">{dayDescription}</span>
        </div>

        {/* Quick Date Presets */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedDate('2026-06-15');
            }}
          >
            Summer Weekday
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedDate('2026-06-20');
            }}
          >
            Summer Weekend
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedDate('2026-03-29');
            }}
          >
            Spring Forward (23h DST)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedDate('2026-10-25');
            }}
          >
            Fall Back (25h DST)
          </Button>
        </div>

        {/* 24-hour visual bar */}
        <div className="mt-2">
          <div
            className="flex h-14 w-full overflow-hidden rounded-control border border-field-border bg-space-950 p-1"
            role="img"
            aria-label={`24-hour tariff schedule for ${selectedDate}: ${dayDescription}`}
          >
            {segments.map((seg, idx) => (
              <div
                key={`${seg.startMs}-${idx}`}
                style={{ width: `${Math.max(1, seg.widthPercent)}%` }}
                className={`flex flex-col justify-center border-l px-1 text-center transition-all first:border-l-0 ${seg.colorClass}`}
                title={`${seg.startLocal} - ${seg.endLocal}: ${seg.rateText} (${seg.label})`}
              >
                <span className="truncate text-xs font-semibold">{seg.label}</span>
                <span className="truncate text-[10px] opacity-90">{seg.rateText}</span>
              </div>
            ))}
          </div>

          <div className="mt-1 flex justify-between text-[10px] text-ink-muted">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>{isDstDay ? `${totalMinutes / 60}:00` : '24:00'}</span>
          </div>
        </div>

        {/* Accessible Segment Breakdown Table */}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th className="py-1.5 font-medium">Window</th>
                <th className="py-1.5 font-medium">Duration</th>
                <th className="py-1.5 font-medium">Label</th>
                <th className="py-1.5 font-medium">Source</th>
                <th className="py-1.5 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, idx) => (
                <tr key={`${seg.startMs}-${idx}`} className="border-b border-line/40">
                  <td className="py-1.5 font-mono">
                    {seg.startLocal} – {seg.endLocal}
                  </td>
                  <td className="py-1.5 text-ink-muted">{seg.durationMinutes}m</td>
                  <td className="py-1.5 font-medium">{seg.label}</td>
                  <td className="py-1.5 text-ink-muted">{seg.source}</td>
                  <td className="py-1.5 text-right font-mono">{seg.rateText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </GlassCard>
  );
}
