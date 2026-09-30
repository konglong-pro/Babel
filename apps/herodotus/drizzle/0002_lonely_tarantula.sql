CREATE TABLE `note_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_note_id` integer NOT NULL,
	`target_title_key` text NOT NULL,
	`target_note_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_link_source_title_unique` ON `note_link` (`source_note_id`,`target_title_key`);--> statement-breakpoint
CREATE INDEX `note_link_target_idx` ON `note_link` (`target_note_id`);--> statement-breakpoint
CREATE INDEX `note_link_title_key_idx` ON `note_link` (`target_title_key`);