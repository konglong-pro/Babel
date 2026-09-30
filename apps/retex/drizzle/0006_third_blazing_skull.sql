ALTER TABLE `folder` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH `ranked` AS (
	SELECT
		`id`,
		ROW_NUMBER() OVER (
			PARTITION BY `type`, `parent_id`
			ORDER BY `name`, `id`
		) - 1 AS `position`
	FROM `folder`
)
UPDATE `folder`
SET `position` = (
	SELECT `ranked`.`position`
	FROM `ranked`
	WHERE `ranked`.`id` = `folder`.`id`
);--> statement-breakpoint
CREATE INDEX `folder_type_parent_position_idx` ON `folder` (`type`,`parent_id`,`position`,`id`);
