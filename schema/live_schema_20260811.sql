-- Live RLMS schema dump (public)
-- Source: qgdrgiqrkoyhvbakuqwo (read-only export)
-- Generated: 2026-08-11T21:44:40.721Z
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


CREATE TABLE IF NOT EXISTS "assignment_history" (
  "id" integer DEFAULT nextval('assignment_history_id_seq'::regclass) NOT NULL,
  "railcar_id" integer NOT NULL,
  "from_rider_id" integer,
  "to_rider_id" integer,
  "from_fleet_name" text,
  "to_fleet_name" text,
  "moved_at" timestamp with time zone DEFAULT now(),
  "moved_by" text,
  "reason" text
);

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" bigint DEFAULT nextval('attachments_id_seq'::regclass) NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" bigint NOT NULL,
  "file_name" text NOT NULL,
  "file_size" bigint NOT NULL,
  "mime_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "uploaded_by" text,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text
);

CREATE TABLE IF NOT EXISTS "car_number_history" (
  "id" bigint DEFAULT nextval('car_number_history_id_seq'::regclass) NOT NULL,
  "railcar_id" bigint NOT NULL,
  "old_car_number" text NOT NULL,
  "new_car_number" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_by" text,
  "reason" text
);

CREATE TABLE IF NOT EXISTS "dispute_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "log_date" date DEFAULT CURRENT_DATE NOT NULL,
  "logged_by" text,
  "description" text NOT NULL,
  "outcome" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dv_ab_codes" (
  "id" bigint DEFAULT nextval('dv_ab_codes_id_seq'::regclass) NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "rate_basis" text NOT NULL,
  "rate" numeric(6,4) NOT NULL,
  "max_depreciation" numeric(4,2) NOT NULL,
  "effective_from" date DEFAULT '1970-01-01'::date NOT NULL,
  "effective_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dv_calculation_ab_items" (
  "id" bigint DEFAULT nextval('dv_calculation_ab_items_id_seq'::regclass) NOT NULL,
  "calculation_id" bigint NOT NULL,
  "seq" integer NOT NULL,
  "code" text NOT NULL,
  "value" numeric(14,2) NOT NULL,
  "install_date" date NOT NULL,
  "rate_basis" text NOT NULL,
  "rate" numeric(6,4) NOT NULL,
  "max_depreciation" numeric(4,2) NOT NULL,
  "notes" text
);

CREATE TABLE IF NOT EXISTS "dv_calculations" (
  "id" bigint DEFAULT nextval('dv_calculations_id_seq'::regclass) NOT NULL,
  "railcar_id" bigint,
  "railroad" text,
  "incident_date" date NOT NULL,
  "incident_location" text,
  "ddct_incident_no" text,
  "car_initial" text NOT NULL,
  "car_number" text NOT NULL,
  "tare_weight_lb" integer,
  "steel_weight_lb" integer,
  "aluminum_weight_lb" integer,
  "stainless_weight_lb" integer DEFAULT 0,
  "non_metallic_lb" integer DEFAULT 0,
  "original_cost" numeric(14,2) NOT NULL,
  "build_date" date NOT NULL,
  "equipment_type" text NOT NULL,
  "total_reproduction" numeric(14,2),
  "total_dv" numeric(14,2),
  "total_salvage" numeric(14,2),
  "salvage_plus_20" numeric(14,2),
  "dismantling_allow" numeric(14,2),
  "over_age_cutoff" boolean,
  "result_json" jsonb,
  "notes" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "visitor_id" text DEFAULT 'anon'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS "dv_car_dep_rates" (
  "id" bigint DEFAULT nextval('dv_car_dep_rates_id_seq'::regclass) NOT NULL,
  "equipment_type" text NOT NULL,
  "display_name" text NOT NULL,
  "annual_rate" numeric(6,4) NOT NULL,
  "max_depreciation" numeric(4,2) NOT NULL,
  "age_cutoff_years" integer NOT NULL,
  "notes" text
);

CREATE TABLE IF NOT EXISTS "dv_cost_factors" (
  "id" bigint DEFAULT nextval('dv_cost_factors_id_seq'::regclass) NOT NULL,
  "year" integer NOT NULL,
  "factor" numeric(10,2) NOT NULL,
  "publication_q" integer DEFAULT 0 NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dv_salvage_quarters" (
  "id" bigint DEFAULT nextval('dv_salvage_quarters_id_seq'::regclass) NOT NULL,
  "quarter_code" integer NOT NULL,
  "steel_per_lb" numeric(10,4),
  "aluminum_per_lb" numeric(10,4),
  "stainless_per_lb" numeric(10,4),
  "dismantling_per_gt" numeric(10,2),
  "loading_flat" numeric(10,2),
  "misc_labor" numeric(10,2),
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "invoice_communications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "comm_date" date DEFAULT CURRENT_DATE NOT NULL,
  "comm_type" text DEFAULT 'email'::text NOT NULL,
  "contact_name" text,
  "notes" text NOT NULL,
  "logged_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" text NOT NULL,
  "lessee_name" text NOT NULL,
  "vendor_name" text,
  "amount" numeric(12,2),
  "amount_paid" numeric(12,2) DEFAULT 0,
  "invoice_date" date,
  "due_date" date,
  "paid_date" date,
  "status" text DEFAULT 'unpaid'::text NOT NULL,
  "is_disputed" boolean DEFAULT false NOT NULL,
  "repair_description" text,
  "notes" text,
  "last_communication_date" date,
  "last_communication_notes" text,
  "next_followup_date" date,
  "pdf_url" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "master_leases" (
  "id" integer DEFAULT nextval('master_leases_id_seq'::regclass) NOT NULL,
  "lease_number" text NOT NULL,
  "agreement_number" text,
  "lessor" text NOT NULL,
  "lessee" text NOT NULL,
  "lease_type" text DEFAULT 'Net Lease'::text NOT NULL,
  "effective_date" date,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "sold_to" text
);

CREATE TABLE IF NOT EXISTS "program_cars" (
  "id" bigint DEFAULT nextval('program_cars_id_seq'::regclass) NOT NULL,
  "program_id" bigint NOT NULL,
  "railcar_id" bigint NOT NULL,
  "notes" text,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "program_documents" (
  "id" bigint DEFAULT nextval('program_documents_id_seq'::regclass) NOT NULL,
  "program_id" bigint NOT NULL,
  "file_name" text NOT NULL,
  "file_url" text NOT NULL,
  "storage_path" text NOT NULL,
  "doc_type" text DEFAULT 'Other'::text NOT NULL,
  "file_size_bytes" bigint,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "programs" (
  "id" bigint DEFAULT nextval('programs_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "railcar_assignments" (
  "id" integer DEFAULT nextval('railcar_assignments_id_seq'::regclass) NOT NULL,
  "railcar_id" integer NOT NULL,
  "rider_id" integer NOT NULL,
  "fleet_name" text,
  "sub_lease_number" text,
  "sublease_expiration_date" date,
  "assigned_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "railcars" (
  "id" integer DEFAULT nextval('railcars_id_seq'::regclass) NOT NULL,
  "car_number" text NOT NULL,
  "reporting_marks" text NOT NULL,
  "car_type" text DEFAULT 'Hopper'::text,
  "capacity_cf" integer,
  "tare_weight_lbs" integer,
  "load_limit_lbs" integer,
  "aar_designation" text,
  "dot_specification" text,
  "built_year" integer,
  "status" text DEFAULT 'Active/In-Service'::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "coating" text,
  "transit_status" text,
  "transit_label" text,
  "entity" text,
  "car_initial" text,
  "old_car_initial" text,
  "old_car_number" text,
  "mechanical_designation" text,
  "general_description" text,
  "lease_type" text,
  "managed" text,
  "managed_category" text,
  "lining_material" text,
  "active" boolean DEFAULT true NOT NULL,
  "sold_to" text,
  "nbv" numeric(12,2),
  "oac" numeric(12,2),
  "oec" numeric(12,2),
  "rider_external_id" text,
  "lessee_name" text,
  "active_status" text,
  "data_source" text,
  "assignment_label" text,
  "lease_start_date" date,
  "lease_end_date" date,
  "lease_expiry" date,
  "monthly_rent_per_car" numeric(14,2),
  "monthly_depr_per_car" numeric(14,2),
  "total_bv_rider" numeric(16,2),
  "cars_on_rider_ar" integer,
  "commodity_family" text,
  "commodity" text,
  "build_year" integer,
  "lining" text,
  "dot_code" text,
  "comment_event_note" text,
  "description" text
);

CREATE TABLE IF NOT EXISTS "rent_events" (
  "id" bigint DEFAULT nextval('rent_events_id_seq'::regclass) NOT NULL,
  "car_id" bigint NOT NULL,
  "event_type" text NOT NULL,
  "event_date" date NOT NULL,
  "reason" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "rider_contacts" (
  "id" bigint DEFAULT nextval('rider_contacts_id_seq'::regclass) NOT NULL,
  "rider_id" bigint NOT NULL,
  "name" text NOT NULL,
  "title" text,
  "email" text,
  "phone" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "riders" (
  "id" integer DEFAULT nextval('riders_id_seq'::regclass) NOT NULL,
  "master_lease_id" integer NOT NULL,
  "rider_name" text NOT NULL,
  "schedule_number" text,
  "effective_date" date,
  "expiration_date" date,
  "permissible_commodity" text,
  "monthly_rate_pct" numeric(10,6),
  "lessors_cost" numeric(15,2),
  "base_term_months" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "monthly_rent_per_car" numeric(10,2) DEFAULT NULL::numeric,
  "sold_to" text
);

CREATE TABLE IF NOT EXISTS "user_column_prefs" (
  "id" bigint DEFAULT nextval('user_column_prefs_id_seq'::regclass) NOT NULL,
  "user_id" uuid NOT NULL,
  "page" text NOT NULL,
  "visible_cols" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "email" text
);

DO $$ BEGIN
  ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "car_number_history" ADD CONSTRAINT "car_number_history_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_logs" ADD CONSTRAINT "dispute_logs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_ab_codes" ADD CONSTRAINT "dv_ab_codes_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_calculation_ab_items" ADD CONSTRAINT "dv_calculation_ab_items_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_calculations" ADD CONSTRAINT "dv_calculations_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_car_dep_rates" ADD CONSTRAINT "dv_car_dep_rates_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_cost_factors" ADD CONSTRAINT "dv_cost_factors_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_salvage_quarters" ADD CONSTRAINT "dv_salvage_quarters_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_communications" ADD CONSTRAINT "invoice_communications_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "master_leases" ADD CONSTRAINT "master_leases_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_cars" ADD CONSTRAINT "program_cars_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_documents" ADD CONSTRAINT "program_documents_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "programs" ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "railcar_assignments" ADD CONSTRAINT "railcar_assignments_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "railcars" ADD CONSTRAINT "railcars_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rent_events" ADD CONSTRAINT "rent_events_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rider_contacts" ADD CONSTRAINT "rider_contacts_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "riders" ADD CONSTRAINT "riders_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_column_prefs" ADD CONSTRAINT "user_column_prefs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_storage_path_key" UNIQUE (storage_path);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_ab_codes" ADD CONSTRAINT "dv_ab_codes_code_effective_from_key" UNIQUE (code, effective_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_car_dep_rates" ADD CONSTRAINT "dv_car_dep_rates_equipment_type_key" UNIQUE (equipment_type);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_cost_factors" ADD CONSTRAINT "dv_cost_factors_year_publication_q_key" UNIQUE (year, publication_q);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_salvage_quarters" ADD CONSTRAINT "dv_salvage_quarters_quarter_code_key" UNIQUE (quarter_code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "master_leases" ADD CONSTRAINT "master_leases_lease_number_key" UNIQUE (lease_number);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_cars" ADD CONSTRAINT "program_cars_program_id_railcar_id_key" UNIQUE (program_id, railcar_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "railcar_assignments" ADD CONSTRAINT "railcar_assignments_railcar_id_key" UNIQUE (railcar_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_column_prefs" ADD CONSTRAINT "user_column_prefs_user_id_page_key" UNIQUE (user_id, page);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_key" UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entity_type_check" CHECK ((entity_type = ANY (ARRAY['master_lease'::text, 'rider'::text, 'railcar'::text])));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_ab_codes" ADD CONSTRAINT "dv_ab_codes_rate_basis_check" CHECK ((rate_basis = ANY (ARRAY['ANNUAL'::text, 'MONTHLY'::text, 'SAME_AS_CAR'::text])));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "programs" ADD CONSTRAINT "programs_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'draft'::text, 'archived'::text])));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rent_events" ADD CONSTRAINT "rent_events_event_type_check" CHECK ((event_type = ANY (ARRAY['on_rent'::text, 'off_rent'::text])));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'viewer'::text])));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_from_rider_id_fkey" FOREIGN KEY (from_rider_id) REFERENCES riders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_railcar_id_fkey" FOREIGN KEY (railcar_id) REFERENCES railcars(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_to_rider_id_fkey" FOREIGN KEY (to_rider_id) REFERENCES riders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "car_number_history" ADD CONSTRAINT "car_number_history_railcar_id_fkey" FOREIGN KEY (railcar_id) REFERENCES railcars(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dispute_logs" ADD CONSTRAINT "dispute_logs_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_calculation_ab_items" ADD CONSTRAINT "dv_calculation_ab_items_calculation_id_fkey" FOREIGN KEY (calculation_id) REFERENCES dv_calculations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "dv_calculations" ADD CONSTRAINT "dv_calculations_railcar_id_fkey" FOREIGN KEY (railcar_id) REFERENCES railcars(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoice_communications" ADD CONSTRAINT "invoice_communications_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_cars" ADD CONSTRAINT "program_cars_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_cars" ADD CONSTRAINT "program_cars_railcar_id_fkey" FOREIGN KEY (railcar_id) REFERENCES railcars(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_documents" ADD CONSTRAINT "program_documents_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "program_documents" ADD CONSTRAINT "program_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "railcar_assignments" ADD CONSTRAINT "railcar_assignments_railcar_id_fkey" FOREIGN KEY (railcar_id) REFERENCES railcars(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "railcar_assignments" ADD CONSTRAINT "railcar_assignments_rider_id_fkey" FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rent_events" ADD CONSTRAINT "rent_events_car_id_fkey" FOREIGN KEY (car_id) REFERENCES railcars(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rider_contacts" ADD CONSTRAINT "rider_contacts_rider_id_fkey" FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "riders" ADD CONSTRAINT "riders_master_lease_id_fkey" FOREIGN KEY (master_lease_id) REFERENCES master_leases(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_column_prefs" ADD CONSTRAINT "user_column_prefs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX idx_assignment_history_railcar ON public.assignment_history USING btree (railcar_id);
CREATE INDEX idx_attachments_entity ON public.attachments USING btree (entity_type, entity_id);
CREATE INDEX idx_car_number_history_railcar_id ON public.car_number_history USING btree (railcar_id);
CREATE INDEX idx_dispute_logs_invoice ON public.dispute_logs USING btree (invoice_id);
CREATE INDEX dv_calc_ab_items_calc_idx ON public.dv_calculation_ab_items USING btree (calculation_id);
CREATE INDEX dv_calc_car_idx ON public.dv_calculations USING btree (car_initial, car_number);
CREATE INDEX dv_calc_incident_date_idx ON public.dv_calculations USING btree (incident_date DESC);
CREATE INDEX dv_calc_railcar_idx ON public.dv_calculations USING btree (railcar_id);
CREATE INDEX idx_dv_calculations_visitor ON public.dv_calculations USING btree (visitor_id, created_at DESC);
CREATE INDEX idx_comms_invoice ON public.invoice_communications USING btree (invoice_id);
CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);
CREATE INDEX idx_invoices_lessee ON public.invoices USING btree (lessee_name);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX idx_program_cars_program_id ON public.program_cars USING btree (program_id);
CREATE INDEX idx_program_cars_railcar_id ON public.program_cars USING btree (railcar_id);
CREATE INDEX idx_program_documents_program_id ON public.program_documents USING btree (program_id);
CREATE INDEX idx_railcar_assignments_railcar ON public.railcar_assignments USING btree (railcar_id);
CREATE INDEX idx_railcar_assignments_rider ON public.railcar_assignments USING btree (rider_id);
CREATE INDEX idx_railcars_active ON public.railcars USING btree (active);
CREATE INDEX idx_railcars_entity ON public.railcars USING btree (entity);
CREATE INDEX idx_railcars_status ON public.railcars USING btree (status);
CREATE INDEX railcars_build_year_idx ON public.railcars USING btree (build_year);
CREATE INDEX railcars_commodity_idx ON public.railcars USING btree (commodity);
CREATE INDEX railcars_entity_idx ON public.railcars USING btree (entity);
CREATE INDEX railcars_managed_category_idx ON public.railcars USING btree (managed_category);
CREATE UNIQUE INDEX railcars_reporting_marks_car_number_uidx ON public.railcars USING btree (reporting_marks, car_number);
CREATE INDEX railcars_rider_external_id_idx ON public.railcars USING btree (rider_external_id);
CREATE INDEX idx_rent_events_car_id ON public.rent_events USING btree (car_id);
CREATE INDEX idx_rent_events_event_date ON public.rent_events USING btree (event_date DESC);
CREATE INDEX idx_rider_contacts_rider_id ON public.rider_contacts USING btree (rider_id);
CREATE INDEX idx_riders_master_lease ON public.riders USING btree (master_lease_id);
CREATE INDEX user_column_prefs_user_id_idx ON public.user_column_prefs USING btree (user_id);
CREATE INDEX user_roles_user_id_idx ON public.user_roles USING btree (user_id);

CREATE OR REPLACE FUNCTION public.railcars_derive_managed_category()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Always derive from raw entity, preserving entity unchanged.
  IF NEW.entity IS NULL THEN
    NEW.managed_category := COALESCE(NEW.managed_category, NULL);
  ELSIF NEW.entity = 'Main' THEN
    NEW.managed_category := 'RESIDCO Owned';
  ELSIF NEW.entity = 'Rail Partners Select' THEN
    NEW.managed_category := 'RPS';
  ELSIF NEW.entity = 'Coal' THEN
    NEW.managed_category := 'Coal';
  ELSE
    -- Unknown entity — leave whatever value is provided (or fall back to entity itself
    -- so legacy records aren't silently blanked on update).
    NEW.managed_category := COALESCE(NEW.managed_category, NEW.entity);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER trg_master_leases_updated_at BEFORE UPDATE ON master_leases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER railcars_derive_managed_category_trg BEFORE INSERT OR UPDATE OF entity ON railcars FOR EACH ROW EXECUTE FUNCTION railcars_derive_managed_category();
CREATE TRIGGER trg_railcars_updated_at BEFORE UPDATE ON railcars FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_rider_contacts_updated_at BEFORE UPDATE ON rider_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_riders_updated_at BEFORE UPDATE ON riders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_roles_updated_at BEFORE UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_full_access" ON "user_roles" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;