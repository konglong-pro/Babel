CREATE TABLE `note_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` integer NOT NULL,
	`target_title_key` text NOT NULL,
	`target_kind` text,
	`target_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "note_link_source_kind_check" CHECK("note_link"."source_kind" in ('knowledge', 'exercise')),
	CONSTRAINT "note_link_target_kind_check" CHECK("note_link"."target_kind" is null or "note_link"."target_kind" in ('knowledge', 'exercise')),
	CONSTRAINT "note_link_target_pair_check" CHECK(("note_link"."target_kind" is null and "note_link"."target_id" is null) or ("note_link"."target_kind" is not null and "note_link"."target_id" is not null)),
	CONSTRAINT "note_link_source_id_check" CHECK("note_link"."source_id" > 0),
	CONSTRAINT "note_link_target_id_check" CHECK("note_link"."target_id" is null or "note_link"."target_id" > 0),
	CONSTRAINT "note_link_title_key_not_blank" CHECK(length("note_link"."target_title_key") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_link_source_title_unique` ON `note_link` (`source_kind`,`source_id`,`target_title_key`);--> statement-breakpoint
CREATE INDEX `note_link_target_idx` ON `note_link` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `note_link_title_key_idx` ON `note_link` (`target_title_key`);