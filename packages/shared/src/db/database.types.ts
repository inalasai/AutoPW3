// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: supabase/migrations, applied to a throwaway PostgreSQL 17 by scripts/db-types.mjs (npm run db:types).
// Regenerate after every migration. `npm run db:types -- --check` fails when this file is out of date.
// This is NOT output of `supabase gen types` (needs Docker); the shape is the same. See docs/DOMAIN_TYPES.md.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          id: number;
          household_id: string | null;
          actor_type: string;
          actor_user_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: Json;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          household_id?: string | null;
          actor_type: string;
          actor_user_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          household_id?: string | null;
          actor_type?: string;
          actor_user_id?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_executions: {
        Row: {
          id: string;
          rule_id: string;
          site_id: string;
          scheduled_slot: string;
          evaluated_at: string;
          mode_at_evaluation: string;
          decision: string;
          reason: string | null;
          command_id: string | null;
        };
        Insert: {
          id?: string;
          rule_id: string;
          site_id: string;
          scheduled_slot: string;
          evaluated_at?: string;
          mode_at_evaluation: string;
          decision: string;
          reason?: string | null;
          command_id?: string | null;
        };
        Update: {
          id?: string;
          rule_id?: string;
          site_id?: string;
          scheduled_slot?: string;
          evaluated_at?: string;
          mode_at_evaluation?: string;
          decision?: string;
          reason?: string | null;
          command_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "automation_executions_command_id_fkey";
            columns: ["command_id"];
            isOneToOne: false;
            referencedRelation: "device_command_log";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_executions_rule_id_site_id_fkey";
            columns: ["rule_id", "site_id"];
            isOneToOne: false;
            referencedRelation: "automation_rules";
            referencedColumns: ["id", "site_id"];
          },
        ];
      };
      automation_rules: {
        Row: {
          id: string;
          household_id: string;
          site_id: string;
          name: string;
          mode: string;
          priority: number;
          definition: Json;
          definition_version: number;
          version: number;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          site_id: string;
          name: string;
          mode?: string;
          priority?: number;
          definition: Json;
          definition_version?: number;
          version?: number;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          household_id?: string;
          site_id?: string;
          name?: string;
          mode?: string;
          priority?: number;
          definition?: Json;
          definition_version?: number;
          version?: number;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_rules_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_rules_site_id_household_id_fkey";
            columns: ["site_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
      cost_rollups_daily: {
        Row: {
          site_id: string;
          local_date: string;
          import_tariff_id: string | null;
          export_tariff_id: string | null;
          currency: string;
          import_energy_cost: number | null;
          export_credit: number | null;
          standing_charge: number | null;
          levies: number | null;
          tax: number | null;
          net_cost: number | null;
          completeness: number;
          computed_at: string;
        };
        Insert: {
          site_id: string;
          local_date: string;
          import_tariff_id?: string | null;
          export_tariff_id?: string | null;
          currency: string;
          import_energy_cost?: number | null;
          export_credit?: number | null;
          standing_charge?: number | null;
          levies?: number | null;
          tax?: number | null;
          net_cost?: number | null;
          completeness: number;
          computed_at?: string;
        };
        Update: {
          site_id?: string;
          local_date?: string;
          import_tariff_id?: string | null;
          export_tariff_id?: string | null;
          currency?: string;
          import_energy_cost?: number | null;
          export_credit?: number | null;
          standing_charge?: number | null;
          levies?: number | null;
          tax?: number | null;
          net_cost?: number | null;
          completeness?: number;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cost_rollups_daily_export_tariff_id_fkey";
            columns: ["export_tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cost_rollups_daily_import_tariff_id_fkey";
            columns: ["import_tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cost_rollups_daily_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      device_command_events: {
        Row: {
          id: number;
          command_id: string;
          at: string;
          from_state: string | null;
          to_state: string;
          phase: string | null;
          detail: Json | null;
        };
        Insert: {
          id?: never;
          command_id: string;
          at?: string;
          from_state?: string | null;
          to_state: string;
          phase?: string | null;
          detail?: Json | null;
        };
        Update: {
          id?: never;
          command_id?: string;
          at?: string;
          from_state?: string | null;
          to_state?: string;
          phase?: string | null;
          detail?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "device_command_events_command_id_fkey";
            columns: ["command_id"];
            isOneToOne: false;
            referencedRelation: "device_command_log";
            referencedColumns: ["id"];
          },
        ];
      };
      device_command_log: {
        Row: {
          id: string;
          household_id: string;
          site_id: string;
          requested_by: string | null;
          origin: string;
          automation_execution_id: string | null;
          kind: string;
          params: Json;
          params_hash: string;
          idempotency_key: string;
          provider_mode: string;
          state: string;
          phase: string;
          requested_at: string;
          dispatched_at: string | null;
          finished_at: string | null;
          error_code: string | null;
          provider_http_status: number | null;
          result: Json | null;
        };
        Insert: {
          id?: string;
          household_id: string;
          site_id: string;
          requested_by?: string | null;
          origin: string;
          automation_execution_id?: string | null;
          kind: string;
          params: Json;
          params_hash: string;
          idempotency_key: string;
          provider_mode: string;
          state?: string;
          phase?: string;
          requested_at?: string;
          dispatched_at?: string | null;
          finished_at?: string | null;
          error_code?: string | null;
          provider_http_status?: number | null;
          result?: Json | null;
        };
        Update: {
          id?: string;
          household_id?: string;
          site_id?: string;
          requested_by?: string | null;
          origin?: string;
          automation_execution_id?: string | null;
          kind?: string;
          params?: Json;
          params_hash?: string;
          idempotency_key?: string;
          provider_mode?: string;
          state?: string;
          phase?: string;
          requested_at?: string;
          dispatched_at?: string | null;
          finished_at?: string | null;
          error_code?: string | null;
          provider_http_status?: number | null;
          result?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "device_command_log_automation_execution_id_fkey";
            columns: ["automation_execution_id"];
            isOneToOne: false;
            referencedRelation: "automation_executions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_command_log_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_command_log_site_id_household_id_fkey";
            columns: ["site_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
      energy_intervals: {
        Row: {
          site_id: string;
          interval_start: string;
          interval_end: string;
          resolution_seconds: number;
          solar_generated_wh: number | null;
          home_consumed_wh: number | null;
          grid_import_wh: number | null;
          grid_export_wh: number | null;
          battery_charged_wh: number | null;
          battery_discharged_wh: number | null;
          source: string;
          quality: string;
          ingested_at: string;
          updated_at: string;
        };
        Insert: {
          site_id: string;
          interval_start: string;
          interval_end: string;
          resolution_seconds: number;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          source: string;
          quality?: string;
          ingested_at?: string;
          updated_at?: string;
        };
        Update: {
          site_id?: string;
          interval_start?: string;
          interval_end?: string;
          resolution_seconds?: number;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          source?: string;
          quality?: string;
          ingested_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "energy_intervals_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      energy_sites: {
        Row: {
          id: string;
          household_id: string;
          provider: string;
          provider_site_id: string;
          name: string | null;
          timezone: string;
          connection_state: string;
          capabilities_snapshot: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          provider: string;
          provider_site_id: string;
          name?: string | null;
          timezone: string;
          connection_state?: string;
          capabilities_snapshot?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          household_id?: string;
          provider?: string;
          provider_site_id?: string;
          name?: string | null;
          timezone?: string;
          connection_state?: string;
          capabilities_snapshot?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "energy_sites_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_invitations: {
        Row: {
          id: string;
          household_id: string;
          email: string | null;
          role: Database["public"]["Enums"]["role_enum"];
          token_hash: string;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          revoked_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          email?: string | null;
          role?: Database["public"]["Enums"]["role_enum"];
          token_hash: string;
          expires_at: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          revoked_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          household_id?: string;
          email?: string | null;
          role?: Database["public"]["Enums"]["role_enum"];
          token_hash?: string;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          revoked_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_invitations_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          household_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["role_enum"];
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          household_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["role_enum"];
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          household_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["role_enum"];
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_settings: {
        Row: {
          household_id: string;
          monthly_spend_cap_usd: number;
          live_background_interval_minutes: number;
          live_on_demand_min_interval_seconds: number;
          on_demand_monthly_allowance: number;
          raw_retention_days: number;
          stale_after_seconds: number;
          automation_paused: boolean;
          paused_by: string | null;
          paused_at: string | null;
          controls_enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          household_id: string;
          monthly_spend_cap_usd?: number;
          live_background_interval_minutes?: number;
          live_on_demand_min_interval_seconds?: number;
          on_demand_monthly_allowance?: number;
          raw_retention_days?: number;
          stale_after_seconds?: number;
          automation_paused?: boolean;
          paused_by?: string | null;
          paused_at?: string | null;
          controls_enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          household_id?: string;
          monthly_spend_cap_usd?: number;
          live_background_interval_minutes?: number;
          live_on_demand_min_interval_seconds?: number;
          on_demand_monthly_allowance?: number;
          raw_retention_days?: number;
          stale_after_seconds?: number;
          automation_paused?: boolean;
          paused_by?: string | null;
          paused_at?: string | null;
          controls_enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_settings_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: true;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          timezone: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      job_locks: {
        Row: {
          key: string;
          owner: string;
          lease_expires_at: string;
        };
        Insert: {
          key: string;
          owner: string;
          lease_expires_at: string;
        };
        Update: {
          key?: string;
          owner?: string;
          lease_expires_at?: string;
        };
        Relationships: [];
      };
      oauth_states: {
        Row: {
          id: string;
          state_hash: string;
          household_id: string;
          user_id: string;
          pkce_verifier_ciphertext: string;
          pkce_nonce: string;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          state_hash: string;
          household_id: string;
          user_id: string;
          pkce_verifier_ciphertext: string;
          pkce_nonce: string;
          expires_at: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          state_hash?: string;
          household_id?: string;
          user_id?: string;
          pkce_verifier_ciphertext?: string;
          pkce_nonce?: string;
          expires_at?: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "oauth_states_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      powerwall_metrics_log: {
        Row: {
          id: number;
          site_id: string;
          sampled_at: string;
          received_at: string;
          timestamp_origin: string;
          solar_power_w: number | null;
          battery_power_w: number | null;
          grid_power_w: number | null;
          load_power_w: number | null;
          battery_soc_percent: number | null;
          grid_status: string | null;
          source: string;
          quality: string;
        };
        Insert: {
          id?: never;
          site_id: string;
          sampled_at: string;
          received_at?: string;
          timestamp_origin: string;
          solar_power_w?: number | null;
          battery_power_w?: number | null;
          grid_power_w?: number | null;
          load_power_w?: number | null;
          battery_soc_percent?: number | null;
          grid_status?: string | null;
          source: string;
          quality?: string;
        };
        Update: {
          id?: never;
          site_id?: string;
          sampled_at?: string;
          received_at?: string;
          timestamp_origin?: string;
          solar_power_w?: number | null;
          battery_power_w?: number | null;
          grid_power_w?: number | null;
          load_power_w?: number | null;
          battery_soc_percent?: number | null;
          grid_status?: string | null;
          source?: string;
          quality?: string;
        };
        Relationships: [
          {
            foreignKeyName: "powerwall_metrics_log_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_usage_daily: {
        Row: {
          household_id: string;
          usage_day: string;
          category: string;
          request_count: number;
          error_count: number;
        };
        Insert: {
          household_id: string;
          usage_day: string;
          category: string;
          request_count?: number;
          error_count?: number;
        };
        Update: {
          household_id?: string;
          usage_day?: string;
          category?: string;
          request_count?: number;
          error_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "provider_usage_daily_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_jobs: {
        Row: {
          id: string;
          kind: string;
          household_id: string | null;
          site_id: string | null;
          dedupe_key: string;
          run_at: string;
          state: string;
          attempts: number;
          max_attempts: number;
          lease_expires_at: string | null;
          locked_by: string | null;
          payload: Json;
          last_error: string | null;
          created_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          kind: string;
          household_id?: string | null;
          site_id?: string | null;
          dedupe_key: string;
          run_at: string;
          state?: string;
          attempts?: number;
          max_attempts?: number;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          payload?: Json;
          last_error?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          kind?: string;
          household_id?: string | null;
          site_id?: string | null;
          dedupe_key?: string;
          run_at?: string;
          state?: string;
          attempts?: number;
          max_attempts?: number;
          lease_expires_at?: string | null;
          locked_by?: string | null;
          payload?: Json;
          last_error?: string | null;
          created_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_jobs_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      system_bootstrap: {
        Row: {
          id: boolean;
          completed_at: string;
          household_id: string | null;
          bootstrap_by_email_hash: string | null;
        };
        Insert: {
          id?: boolean;
          completed_at?: string;
          household_id?: string | null;
          bootstrap_by_email_hash?: string | null;
        };
        Update: {
          id?: boolean;
          completed_at?: string;
          household_id?: string | null;
          bootstrap_by_email_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "system_bootstrap_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      tariff_levies: {
        Row: {
          id: string;
          tariff_id: string;
          name: string;
          kind: string;
          amount: number;
          taxable: boolean;
        };
        Insert: {
          id?: string;
          tariff_id: string;
          name: string;
          kind: string;
          amount: number;
          taxable: boolean;
        };
        Update: {
          id?: string;
          tariff_id?: string;
          name?: string;
          kind?: string;
          amount?: number;
          taxable?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "tariff_levies_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      tariff_overrides: {
        Row: {
          id: string;
          tariff_id: string;
          name: string;
          date_from: string;
          date_to: string;
          priority: number;
        };
        Insert: {
          id?: string;
          tariff_id: string;
          name: string;
          date_from: string;
          date_to: string;
          priority?: number;
        };
        Update: {
          id?: string;
          tariff_id?: string;
          name?: string;
          date_from?: string;
          date_to?: string;
          priority?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tariff_overrides_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      tariff_price_points: {
        Row: {
          tariff_id: string;
          interval_start: string;
          interval_end: string;
          rate_per_kwh: number;
        };
        Insert: {
          tariff_id: string;
          interval_start: string;
          interval_end: string;
          rate_per_kwh: number;
        };
        Update: {
          tariff_id?: string;
          interval_start?: string;
          interval_end?: string;
          rate_per_kwh?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tariff_price_points_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      tariff_seasons: {
        Row: {
          id: string;
          tariff_id: string;
          name: string;
          start_month: number;
          start_day: number;
          end_month: number;
          end_day: number;
        };
        Insert: {
          id?: string;
          tariff_id: string;
          name: string;
          start_month: number;
          start_day: number;
          end_month: number;
          end_day: number;
        };
        Update: {
          id?: string;
          tariff_id?: string;
          name?: string;
          start_month?: number;
          start_day?: number;
          end_month?: number;
          end_day?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tariff_seasons_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      tariff_slots: {
        Row: {
          id: string;
          tariff_id: string;
          season_id: string | null;
          override_id: string | null;
          day_type: string;
          start_minute: number;
          end_minute: number;
          rate_per_kwh: number;
          label: string | null;
        };
        Insert: {
          id?: string;
          tariff_id: string;
          season_id?: string | null;
          override_id?: string | null;
          day_type?: string;
          start_minute: number;
          end_minute: number;
          rate_per_kwh: number;
          label?: string | null;
        };
        Update: {
          id?: string;
          tariff_id?: string;
          season_id?: string | null;
          override_id?: string | null;
          day_type?: string;
          start_minute?: number;
          end_minute?: number;
          rate_per_kwh?: number;
          label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tariff_slots_override_id_tariff_id_fkey";
            columns: ["override_id", "tariff_id"];
            isOneToOne: false;
            referencedRelation: "tariff_overrides";
            referencedColumns: ["id", "tariff_id"];
          },
          {
            foreignKeyName: "tariff_slots_season_id_tariff_id_fkey";
            columns: ["season_id", "tariff_id"];
            isOneToOne: false;
            referencedRelation: "tariff_seasons";
            referencedColumns: ["id", "tariff_id"];
          },
          {
            foreignKeyName: "tariff_slots_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "utility_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      telemetry_rollups_daily: {
        Row: {
          site_id: string;
          local_date: string;
          timezone: string;
          day_start_utc: string;
          day_end_utc: string;
          solar_generated_wh: number | null;
          home_consumed_wh: number | null;
          grid_import_wh: number | null;
          grid_export_wh: number | null;
          battery_charged_wh: number | null;
          battery_discharged_wh: number | null;
          completeness: number;
          resolution_seconds_min: number | null;
          resolution_seconds_max: number | null;
          computed_at: string;
        };
        Insert: {
          site_id: string;
          local_date: string;
          timezone: string;
          day_start_utc: string;
          day_end_utc: string;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          completeness: number;
          resolution_seconds_min?: number | null;
          resolution_seconds_max?: number | null;
          computed_at?: string;
        };
        Update: {
          site_id?: string;
          local_date?: string;
          timezone?: string;
          day_start_utc?: string;
          day_end_utc?: string;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          completeness?: number;
          resolution_seconds_min?: number | null;
          resolution_seconds_max?: number | null;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "telemetry_rollups_daily_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      telemetry_rollups_hourly: {
        Row: {
          site_id: string;
          bucket_start: string;
          solar_generated_wh: number | null;
          home_consumed_wh: number | null;
          grid_import_wh: number | null;
          grid_export_wh: number | null;
          battery_charged_wh: number | null;
          battery_discharged_wh: number | null;
          sample_count: number;
          covered_seconds: number;
          completeness: number;
          resolution_seconds_min: number | null;
          resolution_seconds_max: number | null;
          computed_at: string;
        };
        Insert: {
          site_id: string;
          bucket_start: string;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          sample_count?: number;
          covered_seconds?: number;
          completeness: number;
          resolution_seconds_min?: number | null;
          resolution_seconds_max?: number | null;
          computed_at?: string;
        };
        Update: {
          site_id?: string;
          bucket_start?: string;
          solar_generated_wh?: number | null;
          home_consumed_wh?: number | null;
          grid_import_wh?: number | null;
          grid_export_wh?: number | null;
          battery_charged_wh?: number | null;
          battery_discharged_wh?: number | null;
          sample_count?: number;
          covered_seconds?: number;
          completeness?: number;
          resolution_seconds_min?: number | null;
          resolution_seconds_max?: number | null;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "telemetry_rollups_hourly_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      telemetry_sync_state: {
        Row: {
          site_id: string;
          stream: string;
          last_attempt_at: string | null;
          last_success_at: string | null;
          last_status: string | null;
          last_error_code: string | null;
          cursor: Json | null;
          latest_sample_at: string | null;
          consecutive_failures: number;
        };
        Insert: {
          site_id: string;
          stream: string;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_status?: string | null;
          last_error_code?: string | null;
          cursor?: Json | null;
          latest_sample_at?: string | null;
          consecutive_failures?: number;
        };
        Update: {
          site_id?: string;
          stream?: string;
          last_attempt_at?: string | null;
          last_success_at?: string | null;
          last_status?: string | null;
          last_error_code?: string | null;
          cursor?: Json | null;
          latest_sample_at?: string | null;
          consecutive_failures?: number;
        };
        Relationships: [
          {
            foreignKeyName: "telemetry_sync_state_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id"];
          },
        ];
      };
      tesla_credentials: {
        Row: {
          id: string;
          household_id: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          version: number;
          scopes: string[] | null;
          fleet_api_base_url: string;
          status: string;
          access_expires_at: string | null;
          refresh_issued_at: string | null;
          last_refresh_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          version?: number;
          scopes?: string[] | null;
          fleet_api_base_url: string;
          status?: string;
          access_expires_at?: string | null;
          refresh_issued_at?: string | null;
          last_refresh_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          household_id?: string;
          key_id?: string;
          nonce?: string;
          ciphertext?: string;
          version?: number;
          scopes?: string[] | null;
          fleet_api_base_url?: string;
          status?: string;
          access_expires_at?: string | null;
          refresh_issued_at?: string | null;
          last_refresh_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tesla_credentials_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: true;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          user_id: string;
          display_name: string | null;
          locale: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          display_name?: string | null;
          locale?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string | null;
          locale?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      utility_tariffs: {
        Row: {
          id: string;
          household_id: string;
          site_id: string | null;
          tariff_key: string;
          version: number;
          name: string;
          direction: string;
          price_mode: string;
          currency: string;
          timezone: string;
          effective_from: string;
          effective_to: string | null;
          tax_mode: string;
          vat_rate: number | null;
          flat_rate_per_kwh: number | null;
          standing_charge_per_day: number | null;
          export_payment_model: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          site_id?: string | null;
          tariff_key?: string;
          version?: number;
          name: string;
          direction: string;
          price_mode: string;
          currency: string;
          timezone: string;
          effective_from: string;
          effective_to?: string | null;
          tax_mode?: string;
          vat_rate?: number | null;
          flat_rate_per_kwh?: number | null;
          standing_charge_per_day?: number | null;
          export_payment_model?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          household_id?: string;
          site_id?: string | null;
          tariff_key?: string;
          version?: number;
          name?: string;
          direction?: string;
          price_mode?: string;
          currency?: string;
          timezone?: string;
          effective_from?: string;
          effective_to?: string | null;
          tax_mode?: string;
          vat_rate?: number | null;
          flat_rate_per_kwh?: number | null;
          standing_charge_per_day?: number | null;
          export_payment_model?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "utility_tariffs_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "utility_tariffs_site_id_household_id_fkey";
            columns: ["site_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "energy_sites";
            referencedColumns: ["id", "household_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: {
        Args: {
          p_token: string;
        };
        Returns: string;
      };
      change_member_role: {
        Args: {
          p_household_id: string;
          p_user_id: string;
          p_role: Database["public"]["Enums"]["role_enum"];
        };
        Returns: undefined;
      };
      create_invitation: {
        Args: {
          p_household_id: string;
          p_email?: string;
          p_role?: Database["public"]["Enums"]["role_enum"];
          p_expires_in?: string;
        };
        Returns: { invitation_id: string; invitation_token: string; invitation_expires_at: string }[];
      };
      leave_household: {
        Args: {
          p_household_id: string;
        };
        Returns: undefined;
      };
      remove_member: {
        Args: {
          p_household_id: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      revoke_invitation: {
        Args: {
          p_invitation_id: string;
        };
        Returns: undefined;
      };
      set_automation_paused: {
        Args: {
          p_household_id: string;
          p_paused: boolean;
        };
        Returns: undefined;
      };
      set_rule_mode: {
        Args: {
          p_rule_id: string;
          p_mode: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      role_enum: "READ_ONLY" | "READ_WRITE" | "ADMIN";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

/**
 * Columns of type numeric or bigint. PostgREST returns them as JSON numbers, which are NOT exact. Select money,
 * rates and energy columns cast to text (`col::text`) and parse with the decimal helpers in @autopw3/shared;
 * never do money arithmetic on a column typed `number` above (rule 8, D-014).
 */
export const NUMERIC_COLUMNS = {
  audit_log: ["id"],
  automation_rules: ["version"],
  cost_rollups_daily: ["import_energy_cost", "export_credit", "standing_charge", "levies", "tax", "net_cost", "completeness"],
  device_command_events: ["id"],
  energy_intervals: ["solar_generated_wh", "home_consumed_wh", "grid_import_wh", "grid_export_wh", "battery_charged_wh", "battery_discharged_wh"],
  household_settings: ["monthly_spend_cap_usd"],
  powerwall_metrics_log: ["id", "solar_power_w", "battery_power_w", "grid_power_w", "load_power_w", "battery_soc_percent"],
  tariff_levies: ["amount"],
  tariff_price_points: ["rate_per_kwh"],
  tariff_slots: ["rate_per_kwh"],
  telemetry_rollups_daily: ["solar_generated_wh", "home_consumed_wh", "grid_import_wh", "grid_export_wh", "battery_charged_wh", "battery_discharged_wh", "completeness"],
  telemetry_rollups_hourly: ["solar_generated_wh", "home_consumed_wh", "grid_import_wh", "grid_export_wh", "battery_charged_wh", "battery_discharged_wh", "completeness"],
  utility_tariffs: ["vat_rate", "flat_rate_per_kwh", "standing_charge_per_day"],
} as const;
