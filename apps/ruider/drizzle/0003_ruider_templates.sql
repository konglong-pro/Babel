CREATE TABLE `note_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "note_template_name_not_blank" CHECK(length(trim("note_template"."name")) > 0),
	CONSTRAINT "note_template_name_length" CHECK(length("note_template"."name") <= 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_template_name_unique` ON `note_template` (lower("name"));