CREATE TABLE `reader_underline_note` (
	`underline_id` integer NOT NULL,
	`note_id` integer NOT NULL,
	PRIMARY KEY(`underline_id`, `note_id`),
	FOREIGN KEY (`underline_id`) REFERENCES `reader_underline`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `knowledge_note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_underline_note_target_idx` ON `reader_underline_note` (`note_id`);--> statement-breakpoint
CREATE TABLE `reader_underline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_knowledge_id` integer,
	`source_exercise_id` integer,
	`source_scratch_id` integer,
	`field_key` text NOT NULL,
	`color` text NOT NULL,
	`anchor_start` integer NOT NULL,
	`anchor_end` integer NOT NULL,
	`anchor_exact` text NOT NULL,
	`anchor_prefix` text NOT NULL,
	`anchor_suffix` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_knowledge_id`) REFERENCES `knowledge_note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_exercise_id`) REFERENCES `exercise`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_scratch_id`) REFERENCES `scratch_solution`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reader_underline_single_source" CHECK(("reader_underline"."source_knowledge_id" IS NOT NULL) + ("reader_underline"."source_exercise_id" IS NOT NULL) + ("reader_underline"."source_scratch_id" IS NOT NULL) = 1),
	CONSTRAINT "reader_underline_field_check" CHECK(("reader_underline"."source_knowledge_id" IS NOT NULL AND "reader_underline"."field_key" = 'content') OR ("reader_underline"."source_exercise_id" IS NOT NULL AND "reader_underline"."field_key" IN ('problem', 'answer', 'solution')) OR ("reader_underline"."source_scratch_id" IS NOT NULL AND "reader_underline"."field_key" = 'work')),
	CONSTRAINT "reader_underline_color_check" CHECK("reader_underline"."color" IN ('yellow', 'green', 'blue', 'pink', 'orange')),
	CONSTRAINT "reader_underline_anchor_check" CHECK("reader_underline"."anchor_start" >= 0 AND "reader_underline"."anchor_end" > "reader_underline"."anchor_start" AND length("reader_underline"."anchor_exact") > 0)
);
--> statement-breakpoint
CREATE INDEX `reader_underline_knowledge_source_idx` ON `reader_underline` (`source_knowledge_id`);--> statement-breakpoint
CREATE INDEX `reader_underline_exercise_source_idx` ON `reader_underline` (`source_exercise_id`);--> statement-breakpoint
CREATE INDEX `reader_underline_scratch_source_idx` ON `reader_underline` (`source_scratch_id`);