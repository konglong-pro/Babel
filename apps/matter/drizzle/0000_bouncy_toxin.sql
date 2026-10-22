CREATE TABLE `exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`title` text NOT NULL,
	`image_path` text NOT NULL,
	`answer_md` text DEFAULT '' NOT NULL,
	`solution_md` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exercise_title_not_blank" CHECK(length(trim("exercise"."title")) > 0),
	CONSTRAINT "exercise_image_path_not_blank" CHECK(length(trim("exercise"."image_path")) > 0)
);
--> statement-breakpoint
CREATE INDEX `exercise_folder_idx` ON `exercise` (`folder_id`);--> statement-breakpoint
CREATE INDEX `exercise_title_idx` ON `exercise` (`title`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "folder_type_check" CHECK("folder"."type" in ('knowledge', 'exercise')),
	CONSTRAINT "folder_name_not_blank" CHECK(length(trim("folder"."name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `folder_type_parent_idx` ON `folder` (`type`,`parent_id`);--> statement-breakpoint
CREATE TABLE `knowledge_exercise` (
	`knowledge_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	PRIMARY KEY(`knowledge_id`, `exercise_id`),
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge_note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_exercise_exercise_idx` ON `knowledge_exercise` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `knowledge_note` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`title` text NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_title_not_blank" CHECK(length(trim("knowledge_note"."title")) > 0)
);
--> statement-breakpoint
CREATE INDEX `knowledge_folder_idx` ON `knowledge_note` (`folder_id`);--> statement-breakpoint
CREATE INDEX `knowledge_title_idx` ON `knowledge_note` (`title`);--> statement-breakpoint
CREATE TABLE `scratch_solution` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scratch_exercise_unique` ON `scratch_solution` (`exercise_id`);