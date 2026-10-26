import { describe, expect, it } from 'vitest';
import {
  formStateToCreateRequest,
  minutesToTime,
  slotsToWindows,
  tariffToFormState,
  timeToMinutes,
  windowsToSlots,
  windowToSlots,
} from './windows';
import type { WindowDefinition } from './types';
import { TARIFF_EXAMPLES } from '@autopw3/domain';

describe('windows and slots conversion', () => {
  it('converts time strings to minutes and back', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('23:59')).toBe(1439);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('invalid')).toBe(0);

    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1440)).toBe('24:00');
  });

  it('decomposes a daytime window into a single slot', () => {
    const win: WindowDefinition = {
      id: 'w1',
      dayType: 'ALL',
      startTime: '08:00',
      endTime: '23:00',
      ratePerKwh: '0.350000',
      label: 'Day',
    };
    const slots = windowToSlots(win);
    expect(slots).toEqual([
      {
        dayType: 'ALL',
        startMinute: 480,
        endMinute: 1380,
        ratePerKwh: '0.350000',
        label: 'Day',
      },
    ]);
  });

  it('decomposes a midnight-crossing window into two slots', () => {
    const win: WindowDefinition = {
      id: 'w2',
      dayType: 'ALL',
      startTime: '23:00',
      endTime: '08:00',
      ratePerKwh: '0.180000',
      label: 'Night',
    };
    const slots = windowToSlots(win);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      dayType: 'ALL',
      startMinute: 1380,
      endMinute: 1440,
      ratePerKwh: '0.180000',
      label: 'Night',
    });
    expect(slots[1]).toEqual({
      dayType: 'ALL',
      startMinute: 0,
      endMinute: 480,
      ratePerKwh: '0.180000',
      label: 'Night',
    });
  });

  it('converts multiple windows and sorts slots canonically with windowsToSlots', () => {
    const wins: WindowDefinition[] = [
      {
        id: 'w1',
        dayType: 'ALL',
        startTime: '23:00',
        endTime: '08:00',
        ratePerKwh: '0.180000',
        label: 'Night',
      },
      {
        id: 'w2',
        dayType: 'ALL',
        startTime: '08:00',
        endTime: '23:00',
        ratePerKwh: '0.350000',
        label: 'Day',
      },
    ];
    const slots = windowsToSlots(wins);
    expect(slots).toHaveLength(3);
    expect(slots[0]?.startMinute).toBe(0);
    expect(slots[0]?.endMinute).toBe(480);
    expect(slots[1]?.startMinute).toBe(480);
    expect(slots[1]?.endMinute).toBe(1380);
    expect(slots[2]?.startMinute).toBe(1380);
    expect(slots[2]?.endMinute).toBe(1440);
  });

  it('returns empty array when start and end times are identical', () => {
    const win: WindowDefinition = {
      id: 'w3',
      dayType: 'ALL',
      startTime: '12:00',
      endTime: '12:00',
      ratePerKwh: '0.200000',
      label: 'Empty',
    };
    expect(windowToSlots(win)).toEqual([]);
  });

  it('reconstructs a midnight-crossing window from paired slots', () => {
    const slots = [
      {
        dayType: 'ALL' as const,
        startMinute: 0,
        endMinute: 480,
        ratePerKwh: '0.180000',
        label: 'Night',
      },
      {
        dayType: 'ALL' as const,
        startMinute: 480,
        endMinute: 1380,
        ratePerKwh: '0.350000',
        label: 'Day',
      },
      {
        dayType: 'ALL' as const,
        startMinute: 1380,
        endMinute: 1440,
        ratePerKwh: '0.180000',
        label: 'Night',
      },
    ];

    const windows = slotsToWindows(slots);
    expect(windows).toHaveLength(2);
    const dayWin = windows.find((w) => w.label === 'Day');
    const nightWin = windows.find((w) => w.label === 'Night');

    expect(dayWin).toBeDefined();
    expect(dayWin?.startTime).toBe('08:00');
    expect(dayWin?.endTime).toBe('23:00');

    expect(nightWin).toBeDefined();
    expect(nightWin?.startTime).toBe('23:00');
    expect(nightWin?.endTime).toBe('08:00');
  });

  it('converts between Tariff and TariffFormState seamlessly', () => {
    const original = TARIFF_EXAMPLES.DAY_NIGHT_IMPORT;
    const formState = tariffToFormState(original);

    expect(formState.name).toBe(original.name);
    expect(formState.direction).toBe('IMPORT');
    expect(formState.priceMode).toBe('TIME_OF_USE');
    expect(formState.windows).toHaveLength(2); // Reconstructed Day and Night windows

    const req = formStateToCreateRequest(formState);
    expect(req.name).toBe(original.name);
    expect(req.direction).toBe('IMPORT');
    expect(req.priceMode).toBe('TIME_OF_USE');
    // Decomposed slots should equal original slots (3 slots: 0-480, 480-1380, 1380-1440)
    expect(req.slots).toHaveLength(3);
  });
});
