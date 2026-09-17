CREATE TABLE `entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`notes_md` text DEFAULT '' NOT NULL,
	`code` text,
	`language` text,
	`filename` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "entry_title_not_blank" CHECK(length(trim("entry"."title")) > 0),
	CONSTRAINT "entry_version_positive" CHECK("entry"."version" > 0),
	CONSTRAINT "entry_kind_fields_valid" CHECK((
        ("entry"."kind" = 'knowledge' AND "entry"."code" IS NULL AND "entry"."language" IS NULL AND "entry"."filename" IS NULL)
        OR
        ("entry"."kind" = 'snippet' AND "entry"."code" IS NOT NULL AND "entry"."language" IS NOT NULL AND length(trim("entry"."language")) > 0 AND ("entry"."filename" IS NULL OR length(trim("entry"."filename")) > 0))
      ))
);
--> statement-breakpoint
CREATE INDEX `entry_folder_idx` ON `entry` (`folder_id`);--> statement-breakpoint
CREATE INDEX `entry_kind_idx` ON `entry` (`kind`);--> statement-breakpoint
CREATE INDEX `entry_updated_idx` ON `entry` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `entry_title_idx` ON `entry` (`title`);--> statement-breakpoint
CREATE TABLE `entry_image` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`image_path` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entry_image_path_not_blank" CHECK(length(trim("entry_image"."image_path")) > 0)
);
--> statement-breakpoint
CREATE INDEX `entry_image_entry_idx` ON `entry_image` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_image_path_unique` ON `entry_image` (`image_path`);--> statement-breakpoint
CREATE TABLE `entry_tag` (
	`entry_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_tag_tag_idx` ON `entry_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "folder_name_not_blank" CHECK(length(trim("folder"."name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `folder_parent_idx` ON `folder` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `folder_root_name_unique` ON `folder` (`name_key`) WHERE "folder"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `folder_sibling_name_unique` ON `folder` (`parent_id`,`name_key`) WHERE "folder"."parent_id" is not null;--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	CONSTRAINT "tag_name_not_blank" CHECK(length(trim("tag"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name_key`);--> statement-breakpoint
CREATE TABLE `trash_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_entry_id` integer NOT NULL,
	`folder_id` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`deleted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trash_entry_snapshot_json_valid" CHECK(json_valid("trash_entry"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trash_entry_original_id_unique` ON `trash_entry` (`original_entry_id`);--> statement-breakpoint
CREATE INDEX `trash_entry_folder_idx` ON `trash_entry` (`folder_id`);--> statement-breakpoint
CREATE INDEX `trash_entry_deleted_idx` ON `trash_entry` (`deleted_at`,`id`);--> statement-breakpoint
INSERT INTO `folder` (`name`, `name_key`) VALUES ('Inbox', 'inbox');
