import { describe, expect, it } from 'vitest';
import { evaluateSiteCapabilities, toSiteCapabilityItems } from './capabilities';

describe('Tesla Capabilities Evaluator & D-003 Enforcement', () => {
  it('enforces D-003: forced charge, export, solar bypass, and islanding are NOT_SUPPORTED', () => {
    const caps = evaluateSiteCapabilities({
      storm_mode_capable: true,
      backup_reserve_percent: 20,
    });

    const forcedCharge = caps.find((c) => c.capability === 'forced_charge');
    const forcedExport = caps.find((c) => c.capability === 'forced_export');
    const solarBypass = caps.find((c) => c.capability === 'solar_bypass');
    const islandMode = caps.find((c) => c.capability === 'island_mode');

    expect(forcedCharge?.status).toBe('NOT_SUPPORTED');
    expect(forcedExport?.status).toBe('NOT_SUPPORTED');
    expect(solarBypass?.status).toBe('NOT_SUPPORTED');
    expect(islandMode?.status).toBe('NOT_SUPPORTED');
  });

  it('marks storm_mode as SUPPORTED when site_info says storm_mode_capable=true', () => {
    const caps = evaluateSiteCapabilities({
      storm_mode_capable: true,
    });

    const storm = caps.find((c) => c.capability === 'storm_mode');
    expect(storm?.status).toBe('SUPPORTED');
  });

  it('marks storm_mode as DISABLED_BY_SETTING when site_info says storm_mode_capable=false', () => {
    const caps = evaluateSiteCapabilities({
      storm_mode_capable: false,
    });

    const storm = caps.find((c) => c.capability === 'storm_mode');
    expect(storm?.status).toBe('DISABLED_BY_SETTING');
  });

  it('marks storm_mode as UNVERIFIED when site_info is missing', () => {
    const caps = evaluateSiteCapabilities(undefined);
    const storm = caps.find((c) => c.capability === 'storm_mode');
    expect(storm?.status).toBe('UNVERIFIED');
  });

  it('marks standard documented features as SUPPORTED', () => {
    const caps = evaluateSiteCapabilities();
    const backup = caps.find((c) => c.capability === 'backup_reserve');
    const operation = caps.find((c) => c.capability === 'operational_mode');
    const gridCharging = caps.find((c) => c.capability === 'grid_charging');

    expect(backup?.status).toBe('SUPPORTED');
    expect(operation?.status).toBe('SUPPORTED');
    expect(gridCharging?.status).toBe('SUPPORTED');
  });

  it('converts to SiteCapabilityItem array matching shared schema', () => {
    const caps = evaluateSiteCapabilities({ storm_mode_capable: true });
    const items = toSiteCapabilityItems(caps);

    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.capability).toBeTruthy();
      expect(['SUPPORTED', 'UNVERIFIED', 'NOT_SUPPORTED', 'DISABLED_BY_SETTING']).toContain(
        item.status,
      );
    }
  });
});
