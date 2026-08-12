ALTER TABLE "ride_streams" DROP CONSTRAINT "ride_streams_ride_id_rides_id_fk";
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT "share_links_ride_id_rides_id_fk";
--> statement-breakpoint
DROP INDEX "rides_user_id_idx";--> statement-breakpoint
ALTER TABLE "ride_streams" DROP CONSTRAINT "ride_streams_pkey";--> statement-breakpoint
ALTER TABLE "rides" DROP CONSTRAINT "rides_pkey";--> statement-breakpoint
ALTER TABLE "ride_streams" ADD CONSTRAINT "ride_streams_user_id_ride_id_pk" PRIMARY KEY("user_id","ride_id");--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_user_id_id_pk" PRIMARY KEY("user_id","id");--> statement-breakpoint
ALTER TABLE "ride_streams" ADD CONSTRAINT "ride_streams_user_id_ride_id_rides_user_id_id_fk" FOREIGN KEY ("user_id","ride_id") REFERENCES "public"."rides"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_ride_id_rides_user_id_id_fk" FOREIGN KEY ("user_id","ride_id") REFERENCES "public"."rides"("user_id","id") ON DELETE cascade ON UPDATE no action;