import type { List } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { findInbox, viewQuery } from "./views";

const stamp = "2026-10-01T00:00:00.000Z";
const list = (id: string, name: string, archivedAt: string | null = null): List => ({
  id,
  name,
  folderId: null,
  position: "a0",
  archivedAt,
  createdAt: stamp,
  updatedAt: stamp,
});

const ctx = { today: "2026-10-31", inboxId: "IN" };

describe("viewQuery", () => {
  it("builds each built-in view's query", () => {
    expect(viewQuery("inbox", ctx)).toBe("status=open&limit=500&listId=IN");
    expect(viewQuery("today", ctx)).toBe("status=open&limit=500&dueBefore=2026-10-31");
    expect(viewQuery("next", ctx)).toBe("status=open&limit=500&label=next");
    expect(viewQuery("wip", ctx)).toBe("status=open&limit=500&label=wip");
    expect(viewQuery("waiting", ctx)).toBe("status=open&limit=500&label=waitingOn");
    expect(viewQuery("someday", ctx)).toBe("status=open&limit=500&label=someday");
  });

  it("is null for the inbox when there is no Inbox list", () => {
    expect(viewQuery("inbox", { today: ctx.today, inboxId: undefined })).toBeNull();
  });
});

describe("findInbox", () => {
  it("matches the name in any case and skips archived lists", () => {
    const lists = [list("old", "Inbox", stamp), list("work", "Work"), list("in", "INBOX")];
    expect(findInbox(lists)?.id).toBe("in");
    expect(findInbox([list("old", "inbox", stamp)])).toBeUndefined();
  });
});
