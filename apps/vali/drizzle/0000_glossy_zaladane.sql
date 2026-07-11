CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`order` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "category_id_prefix" CHECK(substr("category"."id", 1, 4) = 'cat_'),
	CONSTRAINT "category_order_integer" CHECK(typeof("category"."order") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_unique` ON `category` (`name`);--> statement-breakpoint
CREATE TABLE `entry` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`order` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "entry_id_prefix" CHECK(substr("entry"."id", 1, 4) = 'ent_'),
	CONSTRAINT "entry_order_integer" CHECK(typeof("entry"."order") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_category_title_unique` ON `entry` (`category_id`,`title`);--> statement-breakpoint
CREATE TABLE `entry_alias` (
	`entry_id` text NOT NULL,
	`alias` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `position`),
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "entry_alias_position_nonnegative" CHECK("entry_alias"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_alias_entry_alias_unique` ON `entry_alias` (`entry_id`,`alias`);--> statement-breakpoint
CREATE TABLE `reflection` (
	`date` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trash_entry` (
	`occurrence_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deleted_at` text,
	`original_entry_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`legacy_source_name` text,
	CONSTRAINT "trash_entry_snapshot_json" CHECK(json_valid("trash_entry"."snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trash_entry_legacy_source_unique` ON `trash_entry` (`legacy_source_name`);--> statement-breakpoint
CREATE TABLE `vault_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`schema_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`default_category_id` text NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "vault_config_singleton" CHECK("vault_config"."id" = 1),
	CONSTRAINT "vault_config_schema_version" CHECK("vault_config"."schema_version" = 1)
);
