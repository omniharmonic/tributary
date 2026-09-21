CREATE TABLE "tb_report" (
	"id" text PRIMARY KEY NOT NULL,
	"at_uri" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"reporter_hash" text,
	"reporter_did" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE INDEX "tb_report_uri_idx" ON "tb_report" USING btree ("at_uri");--> statement-breakpoint
CREATE INDEX "tb_report_open_idx" ON "tb_report" USING btree ("resolved_at","created_at");