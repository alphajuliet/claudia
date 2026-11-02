-- Hand-written: the generated migration rebuilt `tasks` with DROP TABLE, which is needless for one column.
ALTER TABLE `tasks` ADD `priority` text DEFAULT 'normal' NOT NULL CONSTRAINT "tasks_priority_check" CHECK(priority IN ('low', 'normal', 'high'));
