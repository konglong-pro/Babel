CREATE TABLE `folder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "folder_name_not_blank" CHECK(length(trim("folder"."name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `folder_parent_idx` ON `folder` (`parent_id`);
--> statement-breakpoint
CREATE TABLE `note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`parent_id` integer,
	`title` text NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "note_title_not_blank" CHECK(length(trim("note"."title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `note_folder_idx` ON `note` (`folder_id`);
--> statement-breakpoint
CREATE INDEX `note_parent_idx` ON `note` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `note_title_idx` ON `note` (`title`);
--> statement-breakpoint
CREATE TABLE `reflection` (
	`date` text PRIMARY KEY NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "reflection_date_valid" CHECK("reflection"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d', "reflection"."date") = "reflection"."date")
);
--> statement-breakpoint
CREATE INDEX `reflection_updated_idx` ON `reflection` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `note_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_note_id` integer NOT NULL,
	`target_title_key` text NOT NULL,
	`target_note_id` integer,
	`target_reflection_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_reflection_date`) REFERENCES `reflection`(`date`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "note_link_single_target" CHECK("note_link"."target_note_id" IS NULL OR "note_link"."target_reflection_date" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_link_source_title_unique` ON `note_link` (`source_note_id`,`target_title_key`);
--> statement-breakpoint
CREATE INDEX `note_link_target_idx` ON `note_link` (`target_note_id`);
--> statement-breakpoint
CREATE INDEX `note_link_target_reflection_idx` ON `note_link` (`target_reflection_date`);
--> statement-breakpoint
CREATE INDEX `note_link_title_key_idx` ON `note_link` (`target_title_key`);
--> statement-breakpoint
CREATE TABLE `reflection_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_reflection_date` text NOT NULL,
	`target_title_key` text NOT NULL,
	`target_note_id` integer,
	`target_reflection_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_reflection_date`) REFERENCES `reflection`(`date`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_reflection_date`) REFERENCES `reflection`(`date`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reflection_link_single_target" CHECK("reflection_link"."target_note_id" IS NULL OR "reflection_link"."target_reflection_date" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reflection_link_source_title_unique` ON `reflection_link` (`source_reflection_date`,`target_title_key`);
--> statement-breakpoint
CREATE INDEX `reflection_link_target_note_idx` ON `reflection_link` (`target_note_id`);
--> statement-breakpoint
CREATE INDEX `reflection_link_target_reflection_idx` ON `reflection_link` (`target_reflection_date`);
--> statement-breakpoint
CREATE INDEX `reflection_link_title_key_idx` ON `reflection_link` (`target_title_key`);
--> statement-breakpoint
CREATE TABLE `document_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer,
	`reflection_date` text,
	`image_path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reflection_date`) REFERENCES `reflection`(`date`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_image_path_not_blank" CHECK(length(trim("document_image"."image_path")) > 0),
	CONSTRAINT "document_image_single_owner" CHECK(("document_image"."note_id" IS NULL) <> ("document_image"."reflection_date" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `document_image_note_idx` ON `document_image` (`note_id`);
--> statement-breakpoint
CREATE INDEX `document_image_reflection_idx` ON `document_image` (`reflection_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_image_path_unique` ON `document_image` (`image_path`);
--> statement-breakpoint
INSERT INTO `folder` (`name`) VALUES ('Vocabulary'), ('Grammar'), ('Expressions');
