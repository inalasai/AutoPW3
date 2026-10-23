/**
 * @autopw3/shared: the single source of truth for types, schemas, constants and generated database types.
 * Import everything from the package root (`import { RoleSchema } from '@autopw3/shared'`); deep imports are not
 * part of the contract. No logic beyond small pure helpers, and no I/O. See docs/DOMAIN_TYPES.md for the index.
 */

// constants
export * from './constants/roles';
export * from './constants/signs';
export * from './constants/enums';
export * from './constants/errors';
export * from './constants/limits';
export * from './constants/capabilities';

// schemas (each file exports the Zod schema and its inferred type)
export * from './schemas/primitives';
export * from './schemas/decimal';
export * from './schemas/health';
export * from './schemas/identity';
export * from './schemas/sites';
export * from './schemas/telemetry';
export * from './schemas/tariffs';
export * from './schemas/commands';
export * from './schemas/automation';
export * from './schemas/accounting';
export * from './schemas/api';
export * from './schemas/routes';

// generated database types (npm run db:types); describe the database, never replace the schemas above
export { NUMERIC_COLUMNS } from './db/database.types';
export type {
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './db/database.types';

// derived types and helpers
export * from './types/routes';
export * from './canonical';
