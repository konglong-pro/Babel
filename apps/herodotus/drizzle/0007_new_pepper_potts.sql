CREATE TABLE `canvas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`scene` text DEFAULT '{"version":1,"elements":[],"viewport":{"x":0,"y":0,"zoom":1}}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "canvas_title_not_blank" CHECK(length(trim("canvas"."title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `canvas_updated_idx` ON `canvas` (`updated_at`);