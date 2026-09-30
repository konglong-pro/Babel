ALTER TABLE `note` ADD `parent_id` integer REFERENCES note(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `note_parent_idx` ON `note` (`parent_id`);
