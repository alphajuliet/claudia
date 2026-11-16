import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events, tasks } from "../src/db/schema";
import { allowedSender, bodyText, captureEmail, parseEmail, taskFromExtract, type EmailTask, type Extractor, type InboundEmail } from "../src/domain/email";
import { addDays, todayIn } from "../src/lib/recurrence";
import { client, db, makeToken, reset } from "./helpers";

const ME = "me@example.com";
const CF_PASS = "mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com; spf=pass smtp.mailfrom=me@example.com";

const raw = (opts: { from?: string; subject?: string; body?: string; auth?: string | null } = {}) =>
  [
    ...(opts.auth === null ? [] : [`Authentication-Results: ${opts.auth ?? CF_PASS}`]),
    `From: Me <${opts.from ?? ME}>`,
    "To: inbox@claudia.alphajuliet.com",
    `Subject: ${opts.subject ?? "Plumber"}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body ?? "Ring the plumber about the leak by Friday.\n\n-- \nMe",
    "",
  ].join("\r\n");

const email = (overrides: Partial<InboundEmail> = {}): InboundEmail => ({
  envelopeFrom: ME, from: ME, subject: "Plumber", text: "Ring the plumber about the leak.", authResults: CF_PASS, ...overrides,
});

let api: ReturnType<typeof client>;
let inboxId: string;
let homeId: string;

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]));
  await api("PUT", "/api/settings/timeZone", { value: "Australia/Sydney" });
  await api("PUT", "/api/settings/emailSenders", { value: [ME, "Other@Example.org"] });
  inboxId = (await api("POST", "/api/lists", { name: "📥 Capture", inbox: true })).body.id;
  homeId = (await api("POST", "/api/lists", { name: "Home" })).body.id;
  await api("POST", "/api/labels", { name: "next", status: true });
  await api("POST", "/api/labels", { name: "errand" });
});

const only = async () => {
  const rows = await db.select().from(tasks);
  expect(rows).toHaveLength(1);
  return (await api("GET", `/api/tasks/${rows[0]!.id}`)).body;
};
const fixed = (read: Partial<EmailTask>): Extractor => async () => ({
  title: "Ring the plumber", list: null, labels: [], dueDate: null, dueTime: null, startDate: null, priority: "normal", ...read,
});

describe("email senders", () => {
  it("are taken only on Cloudflare's own result: From when DMARC passed, the envelope when SPF did", () => {
    expect(allowedSender(email(), [ME])).toBe(ME);
    expect(allowedSender(email({ from: "other@example.org", envelopeFrom: "bounce@x.net" }), ["OTHER@example.org"])).toBe("other@example.org");
    // Not on the list.
    expect(allowedSender(email(), ["someone@else.com"])).toBeNull();
    // A forwarded message: From is someone else, but the envelope passed SPF.
    expect(allowedSender(email({ from: "boss@work.com", authResults: "mx.cloudflare.net; dmarc=fail; spf=pass" }), [ME])).toBe(ME);
    // DMARC failed and SPF failed: the From header can't be trusted.
    expect(allowedSender(email({ authResults: "mx.cloudflare.net; dkim=pass; dmarc=fail; spf=fail" }), [ME])).toBeNull();
    // A result from anyone but Cloudflare, or none, isn't trusted.
    expect(allowedSender(email({ authResults: "evil.example; dmarc=pass; spf=pass" }), [ME])).toBeNull();
    expect(allowedSender(email({ authResults: null }), [ME])).toBeNull();
  });
});

describe("email bodies", () => {
  it("leave out a signature and the quoted message replied to", () => {
    expect(bodyText("Do it.\r\n\r\n-- \r\nMe")).toBe("Do it.");
    expect(bodyText("Yes please.\n\nOn Mon, 3 Nov 2026 at 9:00, Sam <s@x.com> wrote:\n> Shall I?")).toBe("Yes please.");
  });

  it("parse from MIME, keeping Cloudflare's result", async () => {
    const parsed = await parseEmail(raw(), "bounce@example.com");
    expect(parsed).toMatchObject({ envelopeFrom: "bounce@example.com", from: ME, subject: "Plumber", authResults: CF_PASS });
    expect(parsed.text).toContain("Ring the plumber");
  });
});

describe("what Claude read", () => {
  const context = {
    today: "2026-11-16", timeZone: "Australia/Sydney", lists: ["Home"], labels: [{ name: "errand", status: false }],
    listIds: new Map([["home", "L1"]]),
  };
  it("keeps only lists, labels and dates that exist and are well formed", () => {
    const read: EmailTask = { title: " Fix tap ", list: "home", labels: ["Errand", "made-up"], dueDate: "2026-11-20", dueTime: "09:30", startDate: "Friday", priority: "high" };
    expect(taskFromExtract(read, context, "INBOX")).toEqual({
      listId: "L1", title: "Fix tap", labels: ["errand"], priority: "high", dueAt: "2026-11-19T22:30:00.000Z",
    });
    expect(taskFromExtract({ ...read, list: "Garden", dueDate: "soon" }, context, "INBOX")).toMatchObject({ listId: "INBOX" });
  });
});

describe("capturing an email", () => {
  it("makes the task Claude read, with the email's text as notes, logged as from email", async () => {
    const today = todayIn("Australia/Sydney");
    const parsed = await parseEmail(raw(), ME);
    const out = await captureEmail(db, parsed, fixed({ list: "Home", labels: ["next", "errand"], dueDate: addDays(today, 3) }));
    expect(out).toMatchObject({ ok: true, read: "claude" });
    if (!out.ok) throw new Error("not captured");
    expect(await only()).toMatchObject({
      title: "Ring the plumber", listId: homeId, labels: ["errand", "next"], dueDate: addDays(today, 3),
      notes: "Ring the plumber about the leak by Friday.",
    });
    const [created] = await db.select().from(events).where(and(eq(events.type, "created"), eq(events.entityId, out.taskId)));
    expect(created?.actor).toBe("email");
  });

  it("reads the subject as quick add when Claude fails or isn't set up", async () => {
    const failing: Extractor = async () => { throw new Error("overloaded"); };
    const out = await captureEmail(db, email({ subject: "Call Sam tomorrow #errand" }), failing);
    expect(out).toMatchObject({ ok: true, read: "quick-add" });
    expect(await only()).toMatchObject({
      title: "Call Sam", listId: inboxId, labels: ["errand"], dueDate: addDays(todayIn("Australia/Sydney"), 1), notes: "Ring the plumber about the leak.",
    });
  });

  it("uses the first line of the text when there's no subject, and says no to strangers and empty mail", async () => {
    expect(await captureEmail(db, email({ subject: "", text: "Buy stamps\nand envelopes" }), null)).toMatchObject({ ok: true });
    expect((await only()).title).toBe("Buy stamps");
    expect(await captureEmail(db, email({ from: "x@spam.com", envelopeFrom: "x@spam.com" }), null)).toEqual({ ok: false, reason: "sender" });
    expect(await captureEmail(db, email({ subject: "", text: "  " }), null)).toEqual({ ok: false, reason: "empty" });
    await api("PUT", "/api/settings/emailSenders", { value: [] });
    expect(await captureEmail(db, email(), null)).toEqual({ ok: false, reason: "sender" });
  });

  it("doesn't let an API caller claim to be email", async () => {
    const as = client(await makeToken(["write"]), { "X-Claudia-Client": "email" });
    const sneaky = (await as("POST", "/api/tasks", { listId: inboxId, title: "Sneaky" })).body;
    const [created] = await db.select().from(events).where(and(eq(events.type, "created"), eq(events.entityId, sneaky.id)));
    expect(created?.actor).toBe("cli");
  });
});
