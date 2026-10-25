CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN
	SELECT RAISE(ABORT, 'events is append-only');
END;
