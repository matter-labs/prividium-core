ALTER TABLE "applications" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "image_url" text;