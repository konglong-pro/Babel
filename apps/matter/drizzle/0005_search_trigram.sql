CREATE VIRTUAL TABLE `knowledge_search` USING fts5(
  `title`,
  `content_md`,
  `tags`,
  content='knowledge_note',
  content_rowid='id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `knowledge_search_ai` AFTER INSERT ON `knowledge_note` BEGIN
  INSERT INTO `knowledge_search` (`rowid`, `title`, `content_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`content_md`, new.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `knowledge_search_ad` AFTER DELETE ON `knowledge_note` BEGIN
  INSERT INTO `knowledge_search` (`knowledge_search`, `rowid`, `title`, `content_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`content_md`, old.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `knowledge_search_au` AFTER UPDATE ON `knowledge_note` BEGIN
  INSERT INTO `knowledge_search` (`knowledge_search`, `rowid`, `title`, `content_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`content_md`, old.`tags`);
  INSERT INTO `knowledge_search` (`rowid`, `title`, `content_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`content_md`, new.`tags`);
END;
--> statement-breakpoint
INSERT INTO `knowledge_search` (`knowledge_search`) VALUES ('rebuild');
--> statement-breakpoint
CREATE VIRTUAL TABLE `exercise_search` USING fts5(
  `title`,
  `problem_md`,
  `answer_md`,
  `solution_md`,
  `tags`,
  content='exercise',
  content_rowid='id',
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `exercise_search_ai` AFTER INSERT ON `exercise` BEGIN
  INSERT INTO `exercise_search` (`rowid`, `title`, `problem_md`, `answer_md`, `solution_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`problem_md`, new.`answer_md`, new.`solution_md`, new.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_search_ad` AFTER DELETE ON `exercise` BEGIN
  INSERT INTO `exercise_search` (`exercise_search`, `rowid`, `title`, `problem_md`, `answer_md`, `solution_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`problem_md`, old.`answer_md`, old.`solution_md`, old.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `exercise_search_au` AFTER UPDATE ON `exercise` BEGIN
  INSERT INTO `exercise_search` (`exercise_search`, `rowid`, `title`, `problem_md`, `answer_md`, `solution_md`, `tags`)
  VALUES ('delete', old.`id`, old.`title`, old.`problem_md`, old.`answer_md`, old.`solution_md`, old.`tags`);
  INSERT INTO `exercise_search` (`rowid`, `title`, `problem_md`, `answer_md`, `solution_md`, `tags`)
  VALUES (new.`id`, new.`title`, new.`problem_md`, new.`answer_md`, new.`solution_md`, new.`tags`);
END;
--> statement-breakpoint
INSERT INTO `exercise_search` (`exercise_search`) VALUES ('rebuild');
