-- Status labels: a task has one at most. These six start as status labels, in this order.
ALTER TABLE `labels` ADD `status_position` text;--> statement-breakpoint
UPDATE `labels` SET `status_position` = CASE lower(`name`)
  WHEN 'next' THEN 'a0' WHEN 'waitingon' THEN 'a1' WHEN 'wip' THEN 'a2'
  WHEN 'recurring' THEN 'a3' WHEN 'onhold' THEN 'a4' WHEN 'someday' THEN 'a5'
END WHERE `deleted_at` IS NULL AND lower(`name`) IN ('next', 'waitingon', 'wip', 'recurring', 'onhold', 'someday');
