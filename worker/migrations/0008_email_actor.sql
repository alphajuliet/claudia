-- Rebuilds events to allow the 'email' actor. Dropping the table drops its append-only triggers, so they are made again.
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`before` text,
	`after` text,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	CONSTRAINT "events_actor_check" CHECK(actor IN ('web', 'mcp', 'shortcut', 'cli', 'import', 'email', 'system')),
	CONSTRAINT "events_entity_type_check" CHECK(entity_type IN ('folder', 'list', 'task', 'label', 'filter', 'setting', 'token'))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "entity_type", "entity_id", "type", "before", "after", "at", "actor") SELECT "id", "entity_type", "entity_id", "type", "before", "after", "at", "actor" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE INDEX `events_entity_idx` ON `events` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`,`at`);--> statement-breakpoint
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only');
END;
