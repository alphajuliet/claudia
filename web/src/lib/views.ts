import { VIEWS, type List, type ViewId } from "@claudia/shared";

// What each view shows is the server's (worker/src/domain/views.ts): the web app only names and links them.
export { VIEWS, type ViewId };

/** The label a built-in view shows (and quick add in it gives), if any. */
export const viewLabel = (id: ViewId): string | undefined => VIEWS.find((v) => v.id === id)?.label ?? undefined;

/** The Inbox: the list flagged as it, whatever it's called. */
export const findInbox = (lists: List[]) => lists.find((l) => l.inbox && l.archivedAt === null);
