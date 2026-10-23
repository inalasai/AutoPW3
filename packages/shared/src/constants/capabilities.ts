import type { CommandKind } from './enums';

/**
 * Capability identifiers the registry reports (API contract section 2.6). Derived from the TASK-00 capability
 * matrix (docs/research/TESLA_CAPABILITY_MATRIX_DRAFT.md): rows that are DOCUMENTED become identifiers whose status
 * the registry then reports; rows that are NOT_SUPPORTED are listed so the UI can say so and never offer them.
 * Nothing here claims a capability works: that is a status the registry decides per site (rule 3).
 */
export const READ_CAPABILITIES = ['LIVE_STATUS', 'ENERGY_HISTORY', 'BACKUP_EVENT_HISTORY'] as const;
export type ReadCapability = (typeof READ_CAPABILITIES)[number];

/** One capability per command kind, named identically. */
export const COMMAND_CAPABILITIES = [
  'SET_BACKUP_RESERVE',
  'SET_OPERATION_MODE',
  'SET_GRID_IMPORT_EXPORT',
  'SET_STORM_MODE',
  'SET_OFF_GRID_VEHICLE_CHARGING_RESERVE',
  'SET_TIME_OF_USE_SETTINGS',
] as const satisfies readonly CommandKind[];
export type CommandCapability = (typeof COMMAND_CAPABILITIES)[number];

/** Not documented by Tesla for energy sites, so treated as unsupported and never offered (rule 3). */
export const UNSUPPORTED_CAPABILITIES = [
  'FORCE_GRID_CHARGE',
  'FORCE_GRID_EXPORT',
  'SOLAR_BYPASS',
  'MANUAL_ISLANDING',
  'PER_DEVICE_CONTROL',
] as const;
export type UnsupportedCapability = (typeof UNSUPPORTED_CAPABILITIES)[number];

export const CAPABILITIES = [
  ...READ_CAPABILITIES,
  ...COMMAND_CAPABILITIES,
  ...UNSUPPORTED_CAPABILITIES,
] as const;
export type Capability = (typeof CAPABILITIES)[number];
