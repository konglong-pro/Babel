ALTER TABLE `folder` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked_folder` AS (
	SELECT
		`id`,
		row_number() OVER (
			PARTITION BY `parent_id`
			ORDER BY `created_at`, `id`
		) - 1 AS `next_position`
	FROM `folder`
)
UPDATE `folder`
SET `position` = (
	SELECT `next_position`
	FROM `ranked_folder`
	WHERE `ranked_folder`.`id` = `folder`.`id`
);--> statement-breakpoint
CREATE INDEX `folder_parent_position_idx` ON `folder` (`parent_id`,`position`,`id`);
