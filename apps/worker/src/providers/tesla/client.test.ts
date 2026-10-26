import { describe, expect, it } from 'vitest';
import { TeslaAuthError, TeslaClient, TeslaNetworkError, TeslaRateLimitError } from './client';

describe('Tesla Client & Telemetry Normalisation', () => {
  const token = 'mock-access-token';
  const baseUrl = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
  const siteId = '22222222-2222-4222-8222-222222222222';

  describe('Discovery', () => {
    it('discovers region and fleetApiBaseUrl from /api/1/users/region', async () => {
      const mockFetch: typeof fetch = async (url) => {
        expect(String(url)).toContain('/api/1/users/region');
        return new Response(
          JSON.stringify({
            response: {
              region: 'eu',
              fleet_api_base_url: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const client = new TeslaClient(mockFetch);
      const regionInfo = await client.getRegion(token);
      expect(regionInfo.region).toBe('eu');
      expect(regionInfo.fleetApiBaseUrl).toBe('https://fleet-api.prd.eu.vn.cloud.tesla.com');
    });

    it('lists products and maps energy sites from /api/1/products', async () => {
      const mockFetch: typeof fetch = async (url) => {
        expect(String(url)).toContain('/api/1/products');
        return new Response(
          JSON.stringify({
            response: [
              {
                energy_site_id: '1234567890',
                site_name: 'Main Residence Powerwall',
                resource_type: 'battery',
              },
              {
                id: 'vehicle-vin-001',
                vin: '5YJ3E1EA1JF000000',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const client = new TeslaClient(mockFetch);
      const sites = await client.listProducts(baseUrl, token);
      expect(sites).toHaveLength(1);
      expect(sites[0]!.energySiteId).toBe('1234567890');
      expect(sites[0]!.siteName).toBe('Main Residence Powerwall');
    });
  });

  describe('Telemetry Normalisation & Central Sign Conventions', () => {
    it('maps Tesla live_status fields into project PersistedPowerSample convention', () => {
      const client = new TeslaClient();
      const raw = {
        solar_power: 4500,
        battery_power: -1800, // Charging 1800W in Tesla convention
        grid_power: -900, // Exporting 900W in Tesla convention
        load_power: 1800,
        percentage_charged: 84.5,
        timestamp: '2026-06-15T12:00:00Z',
      };

      const sample = client.normaliseLiveStatus(raw, '2026-06-15T12:00:01Z');
      expect(sample.solarPowerW).toBe(4500);
      // Battery: discharging > 0, charging < 0. Tesla battery_power is negative when discharging, positive when charging.
      // So -(-1800) = 1800 discharging, or -battery_power.
      expect(sample.batteryPowerW).toBe(1800);
      expect(sample.gridPowerW).toBe(-900);
      expect(sample.loadPowerW).toBe(1800);
      expect(sample.batterySocPercent).toBe(84.5);
      expect(sample.source).toBe('TESLA');
    });

    it('handles missing or null telemetry fields safely without throwing', () => {
      const client = new TeslaClient();
      const raw = {
        timestamp: '2026-06-15T12:00:00Z',
      };

      const sample = client.normaliseLiveStatus(raw, '2026-06-15T12:00:01Z');
      expect(sample.solarPowerW).toBeNull();
      expect(sample.batteryPowerW).toBeNull();
      expect(sample.gridPowerW).toBeNull();
      expect(sample.loadPowerW).toBeNull();
      expect(sample.batterySocPercent).toBeNull();
      expect(sample.source).toBe('TESLA');
    });
  });

  describe('Error Handling & Rate Limits', () => {
    it('throws TeslaAuthError on HTTP 401', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Unauthorized token', { status: 401 });
      };

      const client = new TeslaClient(mockFetch);
      await expect(client.getLiveStatus(baseUrl, siteId, token)).rejects.toThrow(TeslaAuthError);
    });

    it('throws TeslaRateLimitError with parsed Retry-After on HTTP 429', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Too many requests', {
          status: 429,
          headers: { 'retry-after': '45' },
        });
      };

      const client = new TeslaClient(mockFetch);
      let capturedError: TeslaRateLimitError | null = null;
      try {
        await client.getLiveStatus(baseUrl, siteId, token);
      } catch (err) {
        if (err instanceof TeslaRateLimitError) {
          capturedError = err;
        }
      }

      expect(capturedError).not.toBeNull();
      expect(capturedError?.statusCode).toBe(429);
      expect(capturedError?.retryAfterSeconds).toBe(45);
    });

    it('throws TeslaNetworkError on fetch failure', async () => {
      const mockFetch: typeof fetch = async () => {
        throw new Error('Connection reset by peer');
      };

      const client = new TeslaClient(mockFetch);
      await expect(client.getLiveStatus(baseUrl, siteId, token)).rejects.toThrow(TeslaNetworkError);
    });
  });
});
