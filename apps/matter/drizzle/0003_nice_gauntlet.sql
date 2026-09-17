CREATE TABLE `note_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` integer NOT NULL,
	`image_path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "note_image_source_kind_check" CHECK("note_image"."source_kind" in ('knowledge', 'exercise')),
	CONSTRAINT "note_image_source_id_check" CHECK("note_image"."source_id" > 0),
	CONSTRAINT "note_image_path_not_blank" CHECK(length(trim("note_image"."image_path")) > 0)
);
--> statement-breakpoint
CREATE INDEX `note_image_source_idx` ON `note_image` (`source_kind`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `note_image_path_unique` ON `note_image` (`image_path`);