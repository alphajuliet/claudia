import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { readCapture } from "../src/routes/capture";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let inbox: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "shortcut" });
  await api("POST", "/api/lists", { name: "Errands" });
  inbox = (await api("POST", "/api/lists", { name: "Inbox", inbox: true })).body;
});

describe("readCapture", () => {
  const tz = "Australia/Sydney";
  const now = new Date("2026-10-30T23:00:00Z"); // Sat 31 Oct, 10:00 am in Sydney

  it("takes out #labels and a trailing date", () => {
    expect(readCapture("Buy milk #errand tomorrow", now, tz)).toEqual({ title: "Buy milk", labels: ["errand"], dueDate: "2026-11-01" });
  });

  it("turns a trailing time into a due time in the user's time zone", () => {
    expect(readCapture("Call Sam mon 3pm", now, tz)).toEqual({ title: "Call Sam", labels: [], dueAt: "2026-11-02T04:00:00.000Z" });
  });

  it("leaves plain text alone", () => {
    expect(readCapture("Think about the garden", now, tz)).toEqual({ title: "Think about the garden", labels: [] });
  });
});

describe("POST /api/capture", () => {
  it("adds the task to the Inbox with its labels, due date and notes, and logs the client", async () => {
    const res = await api("POST", "/api/capture", { text: "Return library books #errand #Next tomorrow", notes: "https://example.com" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ listId: inbox.id, title: "Return library books", labels: ["errand", "Next"], notes: "https://example.com" });
    expect(res.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [created] = await db.select().from(events).where(eq(events.entityId, res.body.id));
    expect(created).toMatchObject({ type: "created", actor: "shortcut" });
  });

  it("finds the Inbox by its flag, whatever it's called", async () => {
    await api("PATCH", `/api/lists/${inbox.id}`, { name: "📥 Capture" });
    await api("POST", "/api/lists", { name: "inbox" }); // Just a name.
    expect((await api("POST", "/api/capture", { text: "Hello" })).body.listId).toBe(inbox.id);
    const other = (await api("POST", "/api/lists", { name: "Triage" })).body;
    await api("PATCH", `/api/lists/${other.id}`, { inbox: true });
    expect((await api("POST", "/api/capture", { text: "Again" })).body.listId).toBe(other.id);
  });

  it("says so when there is no Inbox", async () => {
    await reset();
    api = client(await makeToken(["write"]));
    await api("POST", "/api/lists", { name: "Inbox" }); // Called Inbox, but not the Inbox.
    const res = await api("POST", "/api/capture", { text: "Hello" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("no_inbox");
  });

  it("refuses empty text and read-only tokens", async () => {
    expect((await api("POST", "/api/capture", { text: "   " })).status).toBe(400);
    const reader = client(await makeToken(["read"]));
    expect((await reader("POST", "/api/capture", { text: "Hello" })).status).toBe(403);
  });
});
