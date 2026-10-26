import { normalisePowerReading } from '@autopw3/domain';
import type { PersistedPowerSample } from '@autopw3/shared';
import type { DiscoveredSite, ITeslaClient } from './client';
import type { TeslaRawEnergyHistory, TeslaRawLiveStatus, TeslaRawSiteInfo } from './raw-types';

export class MockTeslaClient implements ITeslaClient {
  readonly mockSiteId: string;
  readonly mockSiteName: string;
  private timestampProvider?: (() => string) | undefined;

  constructor(
    mockSiteId = '22222222-2222-4222-8222-222222222222',
    mockSiteName = 'Mock Tesla Powerwall 3',
    timestampProvider?: (() => string) | undefined,
  ) {
    this.mockSiteId = mockSiteId;
    this.mockSiteName = mockSiteName;
    this.timestampProvider = timestampProvider;
  }

  setTimestampProvider(fn: () => string): void {
    this.timestampProvider = fn;
  }

  async getRegion(_accessToken: string): Promise<{ region: string; fleetApiBaseUrl: string }> {
    return {
      region: 'eu',
      fleetApiBaseUrl: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
    };
  }

  async listProducts(_baseUrl: string, _accessToken: string): Promise<readonly DiscoveredSite[]> {
    return [
      {
        id: this.mockSiteId,
        siteName: this.mockSiteName,
        energySiteId: this.mockSiteId,
      },
    ];
  }

  async getSiteInfo(
    _baseUrl: string,
    _siteId: string,
    _accessToken: string,
  ): Promise<TeslaRawSiteInfo> {
    return {
      id: this.mockSiteId,
      site_name: this.mockSiteName,
      storm_mode_capable: true,
      backup_reserve_percent: 20,
      default_real_mode: 'self_consumption',
      asset_site_id: this.mockSiteId,
      components: {
        solar: true,
        battery: true,
        grid: true,
      },
    };
  }

  async getLiveStatus(
    _baseUrl: string,
    _siteId: string,
    _accessToken: string,
  ): Promise<TeslaRawLiveStatus> {
    return {
      solar_power: 3500,
      battery_power: -1200, // Charging 1200W in Tesla convention
      grid_power: -800, // Exporting 800W
      load_power: 1500,
      percentage_charged: 72.4,
      timestamp: this.timestampProvider ? this.timestampProvider() : new Date().toISOString(),
      grid_status: 'Active',
      island_status: 'on_grid',
    };
  }

  async getCalendarHistory(
    _baseUrl: string,
    _siteId: string,
    _accessToken: string,
    params: { startDate: string; endDate: string; period?: string; timeZone?: string },
  ): Promise<TeslaRawEnergyHistory> {
    return {
      time_series: [
        {
          timestamp: `${params.startDate}T00:00:00Z`,
          solar_energy_exported: 12500,
          generator_energy_exported: 0,
          grid_energy_imported: 8400,
          grid_services_energy_imported: 0,
          grid_services_energy_exported: 0,
          grid_energy_exported_from_solar: 3200,
          grid_energy_exported_from_generator: 0,
          grid_energy_exported_from_battery: 1500,
          battery_energy_exported: 9800,
          battery_energy_imported_from_grid: 0,
          battery_energy_imported_from_solar: 10200,
          battery_energy_imported_from_generator: 0,
          consumer_energy_imported_from_grid: 8400,
          consumer_energy_imported_from_solar: 9300,
          consumer_energy_imported_from_battery: 8300,
          consumer_energy_imported_from_generator: 0,
        },
      ],
    };
  }

  normaliseLiveStatus(raw: TeslaRawLiveStatus, receivedAt: Date | string): PersistedPowerSample {
    const solarRaw = typeof raw['solar_power'] === 'number' ? raw['solar_power'] : null;
    const batteryRaw = typeof raw['battery_power'] === 'number' ? raw['battery_power'] : null;
    const gridRaw = typeof raw['grid_power'] === 'number' ? raw['grid_power'] : null;
    const loadRaw = typeof raw['load_power'] === 'number' ? raw['load_power'] : null;
    const socRaw = typeof raw['percentage_charged'] === 'number' ? raw['percentage_charged'] : null;
    const timestampRaw = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : undefined;

    const normalised = normalisePowerReading(
      {
        sampledAt:
          timestampRaw ?? (typeof receivedAt === 'string' ? receivedAt : receivedAt.toISOString()),
        solarPowerW: solarRaw !== null ? Math.max(0, solarRaw) : null,
        batteryPowerW: batteryRaw !== null ? -batteryRaw : null,
        gridPowerW: gridRaw,
        loadPowerW: loadRaw !== null ? Math.max(0, loadRaw) : null,
        batterySocPercent: socRaw !== null ? Math.min(100, Math.max(0, socRaw)) : null,
      },
      {
        source: 'TESLA',
        receivedAt,
      },
    );

    return normalised.sample;
  }
}
