import type { List } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { findInbox, viewLabel } from "./views";

const stamp = "2026-10-01T00:00:00.000Z";
const list = (id: string, name: string, archivedAt: string | null = null, inbox = name === "Inbox"): List => ({
  id,
  name,
  inbox,
  folderId: null,
  position: "a0",
  archivedAt,
  createdAt: stamp,
  updatedAt: stamp,
});

describe("findInbox", () => {
  it("finds the list flagged as the Inbox, whatever it's called, and not by name", () => {
    expect(findInbox([list("work", "Work"), list("in", "📥 Capture", null, true)])?.id).toBe("in");
    expect(findInbox([list("named", "Inbox", null, false)])).toBeUndefined();
    expect(findInbox([list("old", "Inbox", stamp, true)])).toBeUndefined();
  });
});

describe("viewLabel", () => {
  it("names the label a view shows, if any", () => {
    expect(viewLabel("waiting")).toBe("waitingOn");
    expect(viewLabel("today")).toBeUndefined();
  });
});
