CREATE TABLE `__new_exercise` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`title` text NOT NULL,
	`problem_md` text NOT NULL,
	`answer_md` text DEFAULT '' NOT NULL,
	`solution_md` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exercise_title_not_blank" CHECK(length(trim("__new_exercise"."title")) > 0),
	CONSTRAINT "exercise_problem_not_blank" CHECK(length(trim("__new_exercise"."problem_md")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_exercise` (`id`, `folder_id`, `title`, `problem_md`, `answer_md`, `solution_md`, `tags`, `created_at`, `updated_at`)
SELECT
	`id`,
	`folder_id`,
	`title`,
	'![Problem](/api/uploads/notes/legacy-exercise-' || `id` || '-' || substr(`image_path`, length('data/uploads/exercises/') + 1) || ')',
	`answer_md`,
	`solution_md`,
	`tags`,
	`created_at`,
	`updated_at`
FROM `exercise`;
--> statement-breakpoint
INSERT INTO `note_image` (`source_kind`, `source_id`, `image_path`)
SELECT
	'exercise',
	`id`,
	'data/matter/uploads/notes/legacy-exercise-' || `id` || '-' || substr(`image_path`, length('data/uploads/exercises/') + 1)
FROM `exercise`;
--> statement-breakpoint
DROP TABLE `exercise`;
--> statement-breakpoint
ALTER TABLE `__new_exercise` RENAME TO `exercise`;
--> statement-breakpoint
CREATE INDEX `exercise_folder_idx` ON `exercise` (`folder_id`);
--> statement-breakpoint
CREATE INDEX `exercise_title_idx` ON `exercise` (`title`);
