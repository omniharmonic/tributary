CREATE TABLE "tb_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text,
	"actor" text,
	"action" text NOT NULL,
	"subject" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_credential" (
	"host_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key_version" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_email_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_geocode_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"lat" text,
	"lon" text,
	"precision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_host" (
	"id" text PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"handle" text NOT NULL,
	"door" text NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"display_name" text DEFAULT '' NOT NULL,
	"logo_image_hash" text,
	"region" text NOT NULL,
	"provenance_level" text DEFAULT 'email' NOT NULL,
	"pds_url" text NOT NULL,
	"ownership_exercised_at" timestamp with time zone,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_image_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"source_url" text,
	"source_hash" text,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_inbound_address" (
	"host_id" text PRIMARY KEY NOT NULL,
	"email_token" text NOT NULL,
	"webhook_token" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_oauth_session" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_oauth_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_org_role" (
	"host_id" text NOT NULL,
	"did" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_page_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"meta" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_pending_confirmation" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"source_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"channel" text DEFAULT 'console' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_preview" (
	"id" text PRIMARY KEY NOT NULL,
	"match" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"raw_events" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"tz" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_pushed_event" (
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_removal_block" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_session" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_source" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"type" text NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"fingerprint" text NOT NULL,
	"config" jsonb NOT NULL,
	"secrets_key_version" text,
	"secrets_ciphertext" "bytea",
	"cursor" jsonb,
	"etag" text,
	"last_modified" text,
	"tz" text NOT NULL,
	"interval_ms" integer NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"unchanged_runs" integer DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"identity_mode" text DEFAULT 'uid' NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"default_visibility" text DEFAULT 'public' NOT NULL,
	"audience" jsonb,
	"claimed" boolean DEFAULT true NOT NULL,
	"outage_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_source_event" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"host_id" text NOT NULL,
	"external_id" text NOT NULL,
	"occurrence" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"normalized" jsonb NOT NULL,
	"rkey" text,
	"at_uri" text,
	"at_cid" text,
	"record_created_at" text,
	"blob" jsonb,
	"image_hash" text,
	"record_version" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"visibility" text DEFAULT 'held' NOT NULL,
	"visibility_source" text,
	"space_uri" text,
	"space_record_uri" text,
	"teaser_at_uri" text,
	"override" jsonb,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_since" timestamp with time zone,
	"missing_runs" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "tb_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"not_modified" boolean DEFAULT false NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"published" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "tb_visibility_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"position" integer NOT NULL,
	"match" jsonb NOT NULL,
	"level" text NOT NULL,
	"audience" jsonb,
	"gated_fields" jsonb
);
--> statement-breakpoint
ALTER TABLE "tb_api_key" ADD CONSTRAINT "tb_api_key_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_credential" ADD CONSTRAINT "tb_credential_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_inbound_address" ADD CONSTRAINT "tb_inbound_address_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_org_role" ADD CONSTRAINT "tb_org_role_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_pending_confirmation" ADD CONSTRAINT "tb_pending_confirmation_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_pushed_event" ADD CONSTRAINT "tb_pushed_event_source_id_tb_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tb_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_session" ADD CONSTRAINT "tb_session_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_source" ADD CONSTRAINT "tb_source_host_id_tb_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."tb_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_source_event" ADD CONSTRAINT "tb_source_event_source_id_tb_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tb_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_sync_run" ADD CONSTRAINT "tb_sync_run_source_id_tb_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tb_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_visibility_rule" ADD CONSTRAINT "tb_visibility_rule_source_id_tb_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."tb_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tb_api_key_hash_idx" ON "tb_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "tb_api_key_host_idx" ON "tb_api_key" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "tb_audit_host_idx" ON "tb_audit" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "tb_email_token_email_idx" ON "tb_email_token" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_host_did_idx" ON "tb_host" USING btree ("did");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_host_handle_idx" ON "tb_host" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "tb_host_email_idx" ON "tb_host" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_org_role_idx" ON "tb_org_role" USING btree ("host_id","did");--> statement-breakpoint
CREATE INDEX "tb_pending_host_idx" ON "tb_pending_confirmation" USING btree ("host_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_pushed_event_idx" ON "tb_pushed_event" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "tb_session_host_idx" ON "tb_session" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "tb_source_host_idx" ON "tb_source" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "tb_source_next_run_idx" ON "tb_source" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_source_fingerprint_idx" ON "tb_source" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_source_event_identity_idx" ON "tb_source_event" USING btree ("source_id","external_id","occurrence");--> statement-breakpoint
CREATE INDEX "tb_source_event_host_idx" ON "tb_source_event" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "tb_source_event_state_idx" ON "tb_source_event" USING btree ("state","starts_at");--> statement-breakpoint
CREATE INDEX "tb_source_event_uri_idx" ON "tb_source_event" USING btree ("at_uri");--> statement-breakpoint
CREATE INDEX "tb_sync_run_source_idx" ON "tb_sync_run" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "tb_rule_source_idx" ON "tb_visibility_rule" USING btree ("source_id","position");