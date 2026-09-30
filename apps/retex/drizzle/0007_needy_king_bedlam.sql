ALTER TABLE `exercise` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked_exercises` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `folder_id`
      ORDER BY `updated_at` DESC, `title` ASC, `id` ASC
    ) - 1 AS `new_position`
  FROM `exercise`
)
UPDATE `exercise`
SET `position` = (
  SELECT `new_position`
  FROM `ranked_exercises`
  WHERE `ranked_exercises`.`id` = `exercise`.`id`
);--> statement-breakpoint
CREATE INDEX `exercise_folder_position_idx` ON `exercise` (`folder_id`,`position`,`id`);--> statement-breakpoint
ALTER TABLE `knowledge_note` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked_knowledge` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `folder_id`, `parent_id`
      ORDER BY `updated_at` DESC, `title` ASC, `id` ASC
    ) - 1 AS `new_position`
  FROM `knowledge_note`
)
UPDATE `knowledge_note`
SET `position` = (
  SELECT `new_position`
  FROM `ranked_knowledge`
  WHERE `ranked_knowledge`.`id` = `knowledge_note`.`id`
);--> statement-breakpoint
CREATE INDEX `knowledge_scope_position_idx` ON `knowledge_note` (`folder_id`,`parent_id`,`position`,`id`);
