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
CREATE TABLE `note_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`image_path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_image_path_not_blank" CHECK(length(trim("note_image"."image_path")) > 0)
);
--> statement-breakpoint
CREATE INDEX `note_image_note_idx` ON `note_image` (`note_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_image_path_unique` ON `note_image` (`image_path`);
--> statement-breakpoint
INSERT INTO `folder` (`name`) VALUES ('Vocabulary'), ('Grammar'), ('Expressions');
