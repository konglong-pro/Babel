CREATE TABLE `reader_underline_note` (
	`underline_id` integer NOT NULL,
	`note_id` integer NOT NULL,
	PRIMARY KEY(`underline_id`, `note_id`),
	FOREIGN KEY (`underline_id`) REFERENCES `reader_underline`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reader_underline_note_target_idx` ON `reader_underline_note` (`note_id`);--> statement-breakpoint
CREATE TABLE `reader_underline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_note_id` integer,
	`source_reflection_date` text,
	`field_key` text NOT NULL,
	`color` text NOT NULL,
	`anchor_start` integer NOT NULL,
	`anchor_end` integer NOT NULL,
	`anchor_exact` text NOT NULL,
	`anchor_prefix` text NOT NULL,
	`anchor_suffix` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_reflection_date`) REFERENCES `reflection`(`date`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reader_underline_single_source" CHECK(("reader_underline"."source_note_id" IS NULL) <> ("reader_underline"."source_reflection_date" IS NULL)),
	CONSTRAINT "reader_underline_field_check" CHECK("reader_underline"."field_key" = 'content'),
	CONSTRAINT "reader_underline_color_check" CHECK("reader_underline"."color" IN ('yellow', 'green', 'blue', 'pink', 'orange')),
	CONSTRAINT "reader_underline_anchor_check" CHECK("reader_underline"."anchor_start" >= 0 AND "reader_underline"."anchor_end" > "reader_underline"."anchor_start" AND length("reader_underline"."anchor_exact") > 0)
);
--> statement-breakpoint
CREATE INDEX `reader_underline_note_source_idx` ON `reader_underline` (`source_note_id`);--> statement-breakpoint
CREATE INDEX `reader_underline_reflection_source_idx` ON `reader_underline` (`source_reflection_date`);