CREATE VIRTUAL TABLE `entry_search` USING fts5(
  `title`,
  `notes_md`,
  `code`,
  `language`,
  `filename`,
  content='entry',
  content_rowid='id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `entry_search_ai` AFTER INSERT ON `entry` BEGIN
  INSERT INTO `entry_search` (`rowid`, `title`, `notes_md`, `code`, `language`, `filename`)
  VALUES (new.`id`, new.`title`, new.`notes_md`, new.`code`, new.`language`, new.`filename`);
END;
--> statement-breakpoint
CREATE TRIGGER `entry_search_ad` AFTER DELETE ON `entry` BEGIN
  INSERT INTO `entry_search` (`entry_search`, `rowid`, `title`, `notes_md`, `code`, `language`, `filename`)
  VALUES ('delete', old.`id`, old.`title`, old.`notes_md`, old.`code`, old.`language`, old.`filename`);
END;
--> statement-breakpoint
CREATE TRIGGER `entry_search_au` AFTER UPDATE ON `entry` BEGIN
  INSERT INTO `entry_search` (`entry_search`, `rowid`, `title`, `notes_md`, `code`, `language`, `filename`)
  VALUES ('delete', old.`id`, old.`title`, old.`notes_md`, old.`code`, old.`language`, old.`filename`);
  INSERT INTO `entry_search` (`rowid`, `title`, `notes_md`, `code`, `language`, `filename`)
  VALUES (new.`id`, new.`title`, new.`notes_md`, new.`code`, new.`language`, new.`filename`);
END;
--> statement-breakpoint
INSERT INTO `entry_search` (`entry_search`) VALUES ('rebuild');
--> statement-breakpoint
CREATE VIRTUAL TABLE `tag_search` USING fts5(
  `name`,
  content='tag',
  content_rowid='id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `tag_search_ai` AFTER INSERT ON `tag` BEGIN
  INSERT INTO `tag_search` (`rowid`, `name`) VALUES (new.`id`, new.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `tag_search_ad` AFTER DELETE ON `tag` BEGIN
  INSERT INTO `tag_search` (`tag_search`, `rowid`, `name`)
  VALUES ('delete', old.`id`, old.`name`);
END;
--> statement-breakpoint
CREATE TRIGGER `tag_search_au` AFTER UPDATE ON `tag` BEGIN
  INSERT INTO `tag_search` (`tag_search`, `rowid`, `name`)
  VALUES ('delete', old.`id`, old.`name`);
  INSERT INTO `tag_search` (`rowid`, `name`) VALUES (new.`id`, new.`name`);
END;
--> statement-breakpoint
INSERT INTO `tag_search` (`tag_search`) VALUES ('rebuild');
