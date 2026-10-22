ALTER TABLE `entry` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked_entries` AS (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `kind`, `folder_id`, `parent_id`
      ORDER BY `updated_at` DESC, `id` DESC
    ) - 1 AS `new_position`
  FROM `entry`
)
UPDATE `entry`
SET `position` = (
  SELECT `new_position`
  FROM `ranked_entries`
  WHERE `ranked_entries`.`id` = `entry`.`id`
);--> statement-breakpoint
CREATE INDEX `entry_scope_position_idx` ON `entry` (`kind`,`folder_id`,`parent_id`,`position`,`id`);
