CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`before` text,
	`after` text,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	CONSTRAINT "events_actor_check" CHECK(actor IN ('web', 'mcp', 'shortcut', 'cli', 'import', 'system')),
	CONSTRAINT "events_entity_type_check" CHECK(entity_type IN ('folder', 'list', 'task', 'label', 'filter', 'setting', 'token'))
);
--> statement-breakpoint
CREATE INDEX `events_entity_idx` ON `events` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`,`at`);--> statement-breakpoint
CREATE TABLE `filters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`position` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`context` text NOT NULL,
	`position` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "folders_context_check" CHECK(context IN ('work', 'personal', 'home'))
);
--> statement-breakpoint
CREATE INDEX `folders_parent_idx` ON `folders` (`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_unique` ON `labels` (lower("name"));--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`folder_id` text,
	`position` text NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lists_folder_idx` ON `lists` (`folder_id`,`position`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_labels` (
	`task_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `label_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_labels_label_idx` ON `task_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`parent_id` text,
	`kind` text DEFAULT 'task' NOT NULL,
	`position` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_date` text,
	`due_at` text,
	`start_date` text,
	`snoozed_until` text,
	`recur_rule` text,
	`recur_from` text,
	`completed_at` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_kind_check" CHECK(kind IN ('task', 'heading')),
	CONSTRAINT "tasks_recur_from_check" CHECK("tasks"."recur_from" IS NULL OR recur_from IN ('due', 'completion')),
	CONSTRAINT "tasks_recur_pair_check" CHECK(("tasks"."recur_rule" IS NULL) = ("tasks"."recur_from" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `tasks_list_idx` ON `tasks` (`list_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `tasks_due_date_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_completed_idx` ON `tasks` (`completed_at`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);