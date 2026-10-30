CREATE TABLE `reader_underline_note` (
	`underline_id` integer NOT NULL,
	`note_id` integer NOT NULL,
	FOREIGN KEY (`underline_id`) REFERENCES `reader_underline`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reader_underline_note_unique` ON `reader_underline_note` (`underline_id`,`note_id`);--> statement-breakpoint
CREATE INDEX `reader_underline_note_target_idx` ON `reader_underline_note` (`note_id`);--> statement-breakpoint
CREATE TABLE `reader_underline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_note_id` integer NOT NULL,
	`field_key` text NOT NULL,
	`color` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`exact_text` text NOT NULL,
	`prefix_text` text DEFAULT '' NOT NULL,
	`suffix_text` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `note`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reader_underline_field_check" CHECK("reader_underline"."field_key" = 'content'),
	CONSTRAINT "reader_underline_color_check" CHECK("reader_underline"."color" in ('yellow', 'green', 'blue', 'pink', 'orange')),
	CONSTRAINT "reader_underline_offsets_check" CHECK("reader_underline"."start_offset" >= 0 and "reader_underline"."end_offset" > "reader_underline"."start_offset"),
	CONSTRAINT "reader_underline_exact_check" CHECK(length("reader_underline"."exact_text") > 0)
);
--> statement-breakpoint
CREATE INDEX `reader_underline_source_idx` ON `reader_underline` (`source_note_id`,`id`);