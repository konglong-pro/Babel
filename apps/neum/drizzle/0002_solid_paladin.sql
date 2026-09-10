CREATE TABLE `entry_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_entry_id` integer NOT NULL,
	`target_title_key` text NOT NULL,
	`target_entry_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_link_source_title_unique` ON `entry_link` (`source_entry_id`,`target_title_key`);--> statement-breakpoint
CREATE INDEX `entry_link_target_idx` ON `entry_link` (`target_entry_id`);--> statement-breakpoint
CREATE INDEX `entry_link_title_key_idx` ON `entry_link` (`target_title_key`);