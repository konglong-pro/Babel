ALTER TABLE `note` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked_notes` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `folder_id`, `parent_id`
      ORDER BY `updated_at` DESC, `id` DESC
    ) - 1 AS `new_position`
  FROM `note`
)
UPDATE `note`
SET `position` = (
  SELECT `new_position`
  FROM `ranked_notes`
  WHERE `ranked_notes`.`id` = `note`.`id`
);--> statement-breakpoint
CREATE INDEX `note_scope_position_idx` ON `note` (`folder_id`,`parent_id`,`position`,`id`);
