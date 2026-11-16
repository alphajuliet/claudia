ALTER TABLE `filters` ADD `sort` text;--> statement-breakpoint
ALTER TABLE `filters` ADD `group_by` text;--> statement-breakpoint
ALTER TABLE `filters` ADD `display` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `filters` ADD `folder_id` text REFERENCES folders(id);--> statement-breakpoint
CREATE INDEX `filters_folder_idx` ON `filters` (`folder_id`,`position`);