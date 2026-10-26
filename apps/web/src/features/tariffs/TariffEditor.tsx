import type {
  DayType,
  ExportPaymentModel,
  PriceMode,
  TariffDirection,
  TaxMode,
} from '@autopw3/shared';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/fields';
import { GlassCard } from '../../components/ui/display';
import type { TariffFormState, WindowDefinition } from './types';

export interface TariffEditorProps {
  state: TariffFormState;
  onChange: (updated: TariffFormState) => void;
  disabled?: boolean;
  fieldErrors?: Record<string, string>;
}

function err(field: string, errors: Record<string, string>): { error?: string } {
  const msg = errors[field];
  return msg !== undefined ? { error: msg } : {};
}

export function TariffEditor({
  state,
  onChange,
  disabled = false,
  fieldErrors = {},
}: TariffEditorProps) {
  const update = <K extends keyof TariffFormState>(key: K, value: TariffFormState[K]) => {
    onChange({ ...state, [key]: value });
  };

  const addWindow = () => {
    const newWin: WindowDefinition = {
      id: `win-${Date.now()}`,
      dayType: 'ALL',
      startTime: '08:00',
      endTime: '23:00',
      ratePerKwh: '0.300000',
      label: 'Day',
    };
    update('windows', [...state.windows, newWin]);
  };

  const updateWindow = (index: number, updated: WindowDefinition) => {
    const list = [...state.windows];
    list[index] = updated;
    update('windows', list);
  };

  const removeWindow = (index: number) => {
    const list = state.windows.filter((_, i) => i !== index);
    update('windows', list);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* General Settings */}
      <GlassCard title="Profile Details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Tariff Name"
            value={state.name}
            disabled={disabled}
            {...err('name', fieldErrors)}
            onChange={(e) => {
              update('name', e.target.value);
            }}
          />

          <SelectField
            label="Direction"
            value={state.direction}
            disabled={disabled}
            {...err('direction', fieldErrors)}
            onChange={(e) => {
              const dir = e.target.value as TariffDirection;
              onChange({
                ...state,
                direction: dir,
                // Adjust fields when switching direction
                standingChargePerDay:
                  dir === 'IMPORT' ? state.standingChargePerDay || '0.600000' : '',
                exportPaymentModel: dir === 'EXPORT' ? state.exportPaymentModel || 'PER_KWH' : '',
              });
            }}
          >
            <option value="IMPORT">Import (Buying from grid)</option>
            <option value="EXPORT">Export (Selling to grid)</option>
          </SelectField>

          <SelectField
            label="Price Structure"
            value={state.priceMode}
            disabled={disabled}
            {...err('priceMode', fieldErrors)}
            onChange={(e) => {
              const mode = e.target.value as PriceMode;
              onChange({
                ...state,
                priceMode: mode,
                flatRatePerKwh: mode === 'FLAT' ? state.flatRatePerKwh || '0.300000' : '',
              });
            }}
          >
            <option value="TIME_OF_USE">Time of Use (Scheduled slots)</option>
            <option value="FLAT">Flat Rate</option>
            <option value="DYNAMIC">Dynamic (Wholesale price points)</option>
          </SelectField>

          <TextField
            label="Currency"
            value={state.currency}
            disabled={disabled}
            {...err('currency', fieldErrors)}
            hint="ISO 3-letter code (EUR, GBP, USD)"
            onChange={(e) => {
              update('currency', e.target.value.toUpperCase());
            }}
          />

          <TextField
            label="Timezone"
            value={state.timezone}
            disabled={disabled}
            {...err('timezone', fieldErrors)}
            hint="Standard IANA timezone name"
            onChange={(e) => {
              update('timezone', e.target.value);
            }}
          />

          <TextField
            label="Effective From"
            type="date"
            value={state.effectiveFrom}
            disabled={disabled}
            {...err('effectiveFrom', fieldErrors)}
            onChange={(e) => {
              update('effectiveFrom', e.target.value);
            }}
          />

          <TextField
            label="Effective To"
            type="date"
            value={state.effectiveTo}
            disabled={disabled}
            {...err('effectiveTo', fieldErrors)}
            hint="Leave blank for ongoing / current version"
            onChange={(e) => {
              update('effectiveTo', e.target.value);
            }}
          />

          <SelectField
            label="Tax Mode"
            value={state.taxMode}
            disabled={disabled}
            {...err('taxMode', fieldErrors)}
            onChange={(e) => {
              const mode = e.target.value as TaxMode;
              onChange({
                ...state,
                taxMode: mode,
                vatRatePercent: mode !== 'NONE' ? state.vatRatePercent || '23.0000' : '',
              });
            }}
          >
            <option value="NONE">No VAT (0%)</option>
            <option value="INCLUSIVE">VAT Inclusive (Rates include tax)</option>
            <option value="EXCLUSIVE">VAT Exclusive (Tax added on top)</option>
          </SelectField>

          {state.taxMode !== 'NONE' ? (
            <TextField
              label="VAT Rate (%)"
              value={state.vatRatePercent}
              disabled={disabled}
              {...err('vatRatePercent', fieldErrors)}
              hint='e.g. "23.0000" or "13.5000"'
              onChange={(e) => {
                update('vatRatePercent', e.target.value);
              }}
            />
          ) : null}

          {state.direction === 'IMPORT' ? (
            <TextField
              label={`Daily Standing Charge (${state.currency}/day)`}
              value={state.standingChargePerDay}
              disabled={disabled}
              {...err('standingChargePerDay', fieldErrors)}
              hint='Decimal amount e.g. "0.600000"'
              onChange={(e) => {
                update('standingChargePerDay', e.target.value);
              }}
            />
          ) : (
            <SelectField
              label="Export Payment Model"
              value={state.exportPaymentModel}
              disabled={disabled}
              {...err('exportPaymentModel', fieldErrors)}
              onChange={(e) => {
                update('exportPaymentModel', e.target.value as ExportPaymentModel);
              }}
            >
              <option value="PER_KWH">Paid per kWh</option>
              <option value="NONE">Not paid (Explicit zero)</option>
            </SelectField>
          )}

          {state.priceMode === 'FLAT' ? (
            <TextField
              label={`Flat Rate (${state.currency}/kWh)`}
              value={state.flatRatePerKwh}
              disabled={disabled}
              {...err('flatRatePerKwh', fieldErrors)}
              hint='Decimal amount e.g. "0.300000"'
              onChange={(e) => {
                update('flatRatePerKwh', e.target.value);
              }}
            />
          ) : null}
        </div>
      </GlassCard>

      {/* Time of Use Schedule Editor */}
      {state.priceMode === 'TIME_OF_USE' ? (
        <GlassCard
          title="Daily Schedule Windows"
          actions={
            <Button size="sm" variant="secondary" disabled={disabled} onClick={addWindow}>
              + Add Window
            </Button>
          }
        >
          <p className="mb-4 text-xs text-ink-muted">
            Define rate windows for the day. Windows that cross midnight (such as 23:00 to 08:00)
            are supported and split into engine slots automatically.
          </p>

          <div className="flex flex-col gap-3">
            {state.windows.map((win, idx) => (
              <div
                key={win.id}
                className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-space-950/60 p-3"
              >
                <div className="w-32">
                  <SelectField
                    label="Day Type"
                    value={win.dayType}
                    disabled={disabled}
                    onChange={(e) => {
                      updateWindow(idx, { ...win, dayType: e.target.value as DayType });
                    }}
                  >
                    <option value="ALL">Every Day</option>
                    <option value="WEEKDAY">Weekdays</option>
                    <option value="WEEKEND">Weekends</option>
                  </SelectField>
                </div>

                <div className="w-24">
                  <TextField
                    label="Start Time"
                    type="time"
                    value={win.startTime}
                    disabled={disabled}
                    onChange={(e) => {
                      updateWindow(idx, { ...win, startTime: e.target.value });
                    }}
                  />
                </div>

                <div className="w-24">
                  <TextField
                    label="End Time"
                    type="time"
                    value={win.endTime}
                    disabled={disabled}
                    onChange={(e) => {
                      updateWindow(idx, { ...win, endTime: e.target.value });
                    }}
                  />
                </div>

                <div className="w-32">
                  <TextField
                    label={`Rate (${state.currency}/kWh)`}
                    value={win.ratePerKwh}
                    disabled={disabled}
                    onChange={(e) => {
                      updateWindow(idx, { ...win, ratePerKwh: e.target.value });
                    }}
                  />
                </div>

                <div className="flex-1 min-w-[120px]">
                  <TextField
                    label="Label"
                    value={win.label}
                    disabled={disabled}
                    placeholder="e.g. Night, Day, Peak"
                    onChange={(e) => {
                      updateWindow(idx, { ...win, label: e.target.value });
                    }}
                  />
                </div>

                <div className="pt-5">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={disabled || state.windows.length <= 1}
                    onClick={() => {
                      removeWindow(idx);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
