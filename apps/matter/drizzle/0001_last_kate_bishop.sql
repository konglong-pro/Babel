ALTER TABLE `knowledge_note` ADD `parent_id` integer REFERENCES knowledge_note(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `knowledge_parent_idx` ON `knowledge_note` (`parent_id`);
