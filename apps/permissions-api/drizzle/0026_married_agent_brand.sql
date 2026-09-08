ALTER TABLE "applications" ADD COLUMN "name" text;
UPDATE "applications" apps SET "name" = CONCAT('App ', id) where id <> '10';
ALTER TABLE "applications" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "applications" ADD COLUMN "origin" text;