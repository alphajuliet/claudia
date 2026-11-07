-- Siblings never share a position: requests placing items at the same time retry instead of tying.
-- Written by hand: drizzle-kit splits the coalesce() expressions. Live rows only, so soft-deleted rows keep theirs.
CREATE UNIQUE INDEX `folders_position_unique` ON `folders` (coalesce(`parent_id`, ''), `position`) WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `lists_position_unique` ON `lists` (coalesce(`folder_id`, ''), `position`) WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_position_unique` ON `tasks` (`list_id`, coalesce(`parent_id`, ''), `position`) WHERE `deleted_at` IS NULL;
