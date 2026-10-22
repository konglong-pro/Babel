ALTER TABLE `entry` ADD `parent_id` integer REFERENCES entry(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `entry_parent_idx` ON `entry` (`parent_id`);
