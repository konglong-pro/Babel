CREATE VIRTUAL TABLE `note_search` USING fts5(
  `title`,
  `content_md`,
  `tags`,
  content='note',
  content_rowid='id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `note_search_ai` AFTER INSERT ON `note` BEGIN
  INSERT INTO `note_search` (`rowid`, `title`, `content_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`content_md`, new.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `note_search_ad` AFTER DELETE ON `note` BEGIN
  INSERT INTO `note_search` (`note_search`, `rowid`, `title`, `content_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`content_md`, old.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `note_search_au` AFTER UPDATE ON `note` BEGIN
  INSERT INTO `note_search` (`note_search`, `rowid`, `title`, `content_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`content_md`, old.`tags`);
  INSERT INTO `note_search` (`rowid`, `title`, `content_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`content_md`, new.`tags`);
END;
--> statement-breakpoint
INSERT INTO `note_search` (`note_search`) VALUES ('rebuild');
--> statement-breakpoint
CREATE VIRTUAL TABLE `reflection_search` USING fts5(
  `date` UNINDEXED,
  `content_md`,
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO `reflection_search` (`date`, `content_md`)
SELECT `date`, `content_md` FROM `reflection`;
--> statement-breakpoint
CREATE TRIGGER `reflection_search_ai` AFTER INSERT ON `reflection` BEGIN
  INSERT INTO `reflection_search` (`date`, `content_md`)
  VALUES (new.`date`, new.`content_md`);
END;
--> statement-breakpoint
CREATE TRIGGER `reflection_search_ad` AFTER DELETE ON `reflection` BEGIN
  DELETE FROM `reflection_search` WHERE `date` = old.`date`;
END;
--> statement-breakpoint
CREATE TRIGGER `reflection_search_au` AFTER UPDATE ON `reflection` BEGIN
  DELETE FROM `reflection_search` WHERE `date` = old.`date`;
  INSERT INTO `reflection_search` (`date`, `content_md`)
  VALUES (new.`date`, new.`content_md`);
END;
