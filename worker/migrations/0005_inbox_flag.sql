-- The Inbox is a flag on one list rather than the list called "Inbox", so it can be renamed.
ALTER TABLE `lists` ADD `inbox` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The list that was the Inbox by name (the first, if several) keeps the job.
UPDATE `lists` SET `inbox` = 1 WHERE `id` = (
  SELECT `id` FROM `lists` WHERE `deleted_at` IS NULL AND `archived_at` IS NULL AND lower(`name`) = 'inbox' ORDER BY `position` LIMIT 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_one_inbox` ON `lists` (`inbox`) WHERE `inbox` = 1 AND `deleted_at` IS NULL;
