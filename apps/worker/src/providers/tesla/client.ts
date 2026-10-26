import { normalisePowerReading } from '@autopw3/domain';
import type { PersistedPowerSample } from '@autopw3/shared';
import type { TeslaRawEnergyHistory, TeslaRawLiveStatus, TeslaRawSiteInfo } from './raw-types';

export const DEFAULT_TESLA_API_BASE_URL = 'https://fleet-api.prd.na.vn.cloud.tesla.com';

export class TeslaApiError extends Error {
  readonly statusCode: number;
  readonly endpoint: string;
  readonly responseBody: string | undefined;

  constructor(message: string, statusCode: number, endpoint: string, responseBody?: string) {
    super(message);
    this.name = 'TeslaApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

export class TeslaAuthError extends TeslaApiError {
  constructor(endpoint: string, responseBody?: string) {
    super('Tesla authentication failed or token expired (401)', 401, endpoint, responseBody);
    this.name = 'TeslaAuthError';
  }
}

export class TeslaRateLimitError extends TeslaApiError {
  readonly retryAfterSeconds: number;

  constructor(endpoint: string, retryAfterSeconds = 60, responseBody?: string) {
    super(
      `Tesla rate limit exceeded (429). Retry after ${retryAfterSeconds}s`,
      429,
      endpoint,
      responseBody,
    );
    this.name = 'TeslaRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TeslaNetworkError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, cause?: unknown) {
    super(
      `Network error communicating with Tesla API endpoint ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'TeslaNetworkError';
    this.endpoint = endpoint;
  }
}

export interface DiscoveredSite {
  readonly id: string;
  readonly siteName: string;
  readonly energySiteId: string;
}

export interface ITeslaClient {
  getRegion(accessToken: string): Promise<{ region: string; fleetApiBaseUrl: string }>;
  listProducts(baseUrl: string, accessToken: string): Promise<readonly DiscoveredSite[]>;
  getSiteInfo(baseUrl: string, siteId: string, accessToken: string): Promise<TeslaRawSiteInfo>;
  getLiveStatus(baseUrl: string, siteId: string, accessToken: string): Promise<TeslaRawLiveStatus>;
  getCalendarHistory(
    baseUrl: string,
    siteId: string,
    accessToken: string,
    params: { startDate: string; endDate: string; period?: string; timeZone?: string },
  ): Promise<TeslaRawEnergyHistory>;
  normaliseLiveStatus(raw: TeslaRawLiveStatus, receivedAt: Date | string): PersistedPowerSample;
}

export class TeslaClient implements ITeslaClient {
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  private async executeRequest<T>(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('accept', 'application/json');

    let res: Response;
    try {
      res = await this.fetcher(url, { ...init, headers });
    } catch (err) {
      throw new TeslaNetworkError(url, err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) {
        throw new TeslaAuthError(url, text);
      }
      if (res.status === 429) {
        const retryHeader = res.headers.get('retry-after');
        const retrySec = retryHeader ? parseInt(retryHeader, 10) || 60 : 60;
        throw new TeslaRateLimitError(url, retrySec, text);
      }
      throw new TeslaApiError(
        `Tesla API error HTTP ${res.status}: ${text.substring(0, 200)}`,
        res.status,
        url,
        text,
      );
    }

    return (await res.json()) as T;
  }

  /**
   * Discovers the user's region and corresponding fleet-api base URL (S8).
   * Calls GET /api/1/users/region.
   */
  async getRegion(accessToken: string): Promise<{ region: string; fleetApiBaseUrl: string }> {
    const url = `${DEFAULT_TESLA_API_BASE_URL}/api/1/users/region`;
    const data = await this.executeRequest<{
      response?: { region?: string; fleet_api_base_url?: string };
    }>(url, accessToken);

    const region = data.response?.region ?? 'na';
    const fleetApiBaseUrl = data.response?.fleet_api_base_url ?? DEFAULT_TESLA_API_BASE_URL;

    return { region, fleetApiBaseUrl };
  }

  /**
   * Discovers products / energy sites mapped to user (S6).
   * Calls GET /api/1/products.
   */
  async listProducts(baseUrl: string, accessToken: string): Promise<readonly DiscoveredSite[]> {
    const url = `${baseUrl}/api/1/products`;
    const data = await this.executeRequest<{
      response?: readonly Record<string, unknown>[];
    }>(url, accessToken);

    const items = data.response ?? [];
    const discovered: DiscoveredSite[] = [];

    for (const item of items) {
      const energySiteId = item['energy_site_id'];
      if (energySiteId !== undefined && energySiteId !== null) {
        const idStr = String(energySiteId);
        const name =
          typeof item['site_name'] === 'string' ? item['site_name'] : `Powerwall Site ${idStr}`;
        discovered.push({
          id: idStr,
          siteName: name,
          energySiteId: idStr,
        });
      }
    }

    return discovered;
  }

  /**
   * Retrieves site info (assets, settings, features like storm_mode_capable) (S6).
   * Calls GET /api/1/energy_sites/{id}/site_info.
   */
  async getSiteInfo(
    baseUrl: string,
    siteId: string,
    accessToken: string,
  ): Promise<TeslaRawSiteInfo> {
    const url = `${baseUrl}/api/1/energy_sites/${siteId}/site_info`;
    const data = await this.executeRequest<{ response?: TeslaRawSiteInfo }>(url, accessToken);
    return data.response ?? {};
  }

  /**
   * Retrieves live status (power, state of energy, grid status, storm mode) (S6).
   * Calls GET /api/1/energy_sites/{id}/live_status.
   */
  async getLiveStatus(
    baseUrl: string,
    siteId: string,
    accessToken: string,
  ): Promise<TeslaRawLiveStatus> {
    const url = `${baseUrl}/api/1/energy_sites/${siteId}/live_status`;
    const data = await this.executeRequest<{ response?: TeslaRawLiveStatus }>(url, accessToken);
    return data.response ?? {};
  }

  /**
   * Retrieves calendar history for energy measurements (S6).
   * Calls GET /api/1/energy_sites/{id}/calendar_history?kind=energy...
   */
  async getCalendarHistory(
    baseUrl: string,
    siteId: string,
    accessToken: string,
    params: { startDate: string; endDate: string; period?: string; timeZone?: string },
  ): Promise<TeslaRawEnergyHistory> {
    const query = new URLSearchParams({
      kind: 'energy',
      start_date: params.startDate,
      end_date: params.endDate,
    });
    if (params.period) {
      query.set('period', params.period);
    }
    if (params.timeZone) {
      query.set('time_zone', params.timeZone);
    }

    const url = `${baseUrl}/api/1/energy_sites/${siteId}/calendar_history?${query.toString()}`;
    const data = await this.executeRequest<{ response?: TeslaRawEnergyHistory }>(url, accessToken);
    return data.response ?? {};
  }

  /**
   * Normalises raw live status into the project's central PersistedPowerSample.
   * Enforces central sign conventions:
   * - solarPowerW >= 0
   * - batteryPowerW: > 0 discharging, < 0 charging
   * - gridPowerW: > 0 importing from grid, < 0 exporting to grid
   * - loadPowerW >= 0
   */
  normaliseLiveStatus(raw: TeslaRawLiveStatus, receivedAt: Date | string): PersistedPowerSample {
    const solarRaw = typeof raw['solar_power'] === 'number' ? raw['solar_power'] : null;
    const batteryRaw = typeof raw['battery_power'] === 'number' ? raw['battery_power'] : null;
    const gridRaw = typeof raw['grid_power'] === 'number' ? raw['grid_power'] : null;
    const loadRaw = typeof raw['load_power'] === 'number' ? raw['load_power'] : null;
    const socRaw = typeof raw['percentage_charged'] === 'number' ? raw['percentage_charged'] : null;
    const timestampRaw = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : undefined;

    // Normalise signs:
    // In Tesla Fleet API:
    // - solar_power: W generated (>= 0)
    // - battery_power: positive = charging (absorbing power from system), negative = discharging.
    //   Our central convention: battery > 0 discharging, < 0 charging.
    //   Therefore: internalBatteryPowerW = -battery_power.
    // - grid_power: positive = importing (drawing from grid), negative = exporting.
    //   Matches our central convention: grid > 0 importing, < 0 exporting.
    // - load_power: home consumption (>= 0).
    const solarPowerW = solarRaw !== null ? Math.max(0, solarRaw) : null;
    const batteryPowerW = batteryRaw !== null ? -batteryRaw : null;
    const gridPowerW = gridRaw;
    const loadPowerW = loadRaw !== null ? Math.max(0, loadRaw) : null;
    const batterySocPercent = socRaw !== null ? Math.min(100, Math.max(0, socRaw)) : null;

    const normalised = normalisePowerReading(
      {
        sampledAt:
          timestampRaw ?? (typeof receivedAt === 'string' ? receivedAt : receivedAt.toISOString()),
        solarPowerW,
        batteryPowerW,
        gridPowerW,
        loadPowerW,
        batterySocPercent,
      },
      {
        source: 'TESLA',
        receivedAt,
      },
    );

    return normalised.sample;
  }
}
