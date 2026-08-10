CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_streams" (
	"ride_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sample_count" integer NOT NULL,
	"time" "bytea" NOT NULL,
	"distance" "bytea" NOT NULL,
	"altitude" "bytea" NOT NULL,
	"latlng" "bytea",
	"speed" "bytea",
	"heartrate" "bytea",
	"cadence" "bytea",
	"power" "bytea",
	"temperature" "bytea",
	"paused" "bytea"
);
--> statement-breakpoint
CREATE TABLE "rider_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"rider_kg" real NOT NULL,
	"bike_kg" real NOT NULL,
	"position_id" text NOT NULL,
	"surface_id" text NOT NULL,
	"ftp" integer NOT NULL,
	"configured" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"local_date" text NOT NULL,
	"sport" text DEFAULT 'cycling' NOT NULL,
	"sample_count" integer NOT NULL,
	"altitude_source" text NOT NULL,
	"has_measured_power" boolean DEFAULT false NOT NULL,
	"devices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_seconds" integer NOT NULL,
	"moving_seconds" integer NOT NULL,
	"distance_meters" double precision NOT NULL,
	"elevation_gain_meters" double precision NOT NULL,
	"mean_power" real NOT NULL,
	"weighted_power" real NOT NULL,
	"load" real NOT NULL,
	"mean_heart_rate" real,
	"decoupling_percent" real,
	"confidence" text NOT NULL,
	"blob_path" text,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" text PRIMARY KEY NOT NULL,
	"ride_id" text NOT NULL,
	"user_id" text NOT NULL,
	"privacy_radius_meters" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_streams" ADD CONSTRAINT "ride_streams_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_streams" ADD CONSTRAINT "ride_streams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_settings" ADD CONSTRAINT "rider_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rides_user_started_idx" ON "rides" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "rides_user_date_idx" ON "rides" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_user_id_idx" ON "rides" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "share_links_ride_idx" ON "share_links" USING btree ("ride_id");