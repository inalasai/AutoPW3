import type {
  CreateTariffRequest,
  DayType,
  ExportPaymentModel,
  PriceMode,
  Role,
  Tariff,
  TariffDirection,
  TariffLevy,
  TariffOverride,
  TariffProblem,
  TariffSeason,
  TaxMode,
} from '@autopw3/shared';

/** A user-friendly time window that may cross midnight (e.g. 23:00 to 08:00). */
export interface WindowDefinition {
  id: string;
  dayType: DayType;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  ratePerKwh: string; // decimal string e.g. "0.180000"
  label: string; // e.g. "Night"
}

export interface TariffFormState {
  id?: string | undefined;
  tariffKey?: string | undefined;
  version?: number | undefined;
  siteId: string | null;
  name: string;
  direction: TariffDirection;
  priceMode: PriceMode;
  currency: string;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string; // empty string or YYYY-MM-DD
  taxMode: TaxMode;
  vatRatePercent: string; // decimal string or empty
  flatRatePerKwh: string; // decimal string or empty
  standingChargePerDay: string; // decimal string or empty
  exportPaymentModel: ExportPaymentModel | '';
  windows: WindowDefinition[];
  seasons: TariffSeason[];
  overrides: TariffOverride[];
  levies: TariffLevy[];
}

export interface TariffRepository {
  listTariffs(siteId?: string | null): Promise<Tariff[]>;
  getTariff(id: string): Promise<Tariff | null>;
  saveTariff(request: CreateTariffRequest, currentRole: Role | null): Promise<Tariff>;
  endTariff(id: string, effectiveTo: string, currentRole: Role | null): Promise<Tariff>;
}

export interface ValidationSummary {
  valid: boolean;
  problems: TariffProblem[];
  fieldErrors: Record<string, string>;
}
