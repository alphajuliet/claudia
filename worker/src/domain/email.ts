/**
 * Email capture: mail to the Inbox address becomes a task. Email Routing hands the message to the Worker's `email`
 * handler; this module checks the sender, has Claude read the email into task fields (falling back to the quick-add
 * parser), and creates the task. See docs/email-capture.md.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, eq, isNull } from "drizzle-orm";
import PostalMime from "postal-mime";
import { z } from "zod/v4";
import { PRIORITIES, zonedToUtc } from "@claudia/shared";
import { labels, lists, settings } from "../db/schema";
import type { Db } from "../lib/db";
import { todayIn, userTimeZone } from "../lib/recurrence";
import { readCapture } from "../routes/capture";
import { findInbox } from "../routes/lists";
import { createTask, type TaskCreate } from "./tasks";

/** The setting holding the addresses allowed to add tasks by email. */
export const EMAIL_SENDERS_KEY = "emailSenders";
/** The model that reads emails: small and quick, for a short extraction. */
export const EMAIL_MODEL = "claude-haiku-5-5";
/** Notes keep the email's text up to this many characters. */
const MAX_NOTES = 20_000;

/** An email as the handler needs it. */
export interface InboundEmail {
  /** The envelope sender (MAIL FROM). */
  envelopeFrom: string;
  /** The From header's address. */
  from: string | null;
  subject: string;
  text: string;
  /** The first Authentication-Results header, which Email Routing adds. */
  authResults: string | null;
}

/** Parses a raw MIME message. */
export async function parseEmail(raw: ReadableStream | ArrayBuffer | string, envelopeFrom: string): Promise<InboundEmail> {
  const email = await PostalMime.parse(raw);
  const auth = email.headers.find((h) => h.key.toLowerCase() === "authentication-results");
  const text = email.text ?? (email.html ? email.html.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ") : "");
  return { envelopeFrom, from: email.from?.address ?? null, subject: (email.subject ?? "").trim(), text, authResults: auth?.value ?? null };
}

/**
 * The sender, if authenticated and allowed. Email Routing has already rejected mail failing both SPF and DKIM; the
 * result it records (`mx.cloudflare.net`, the first Authentication-Results header) says which identity passed: the
 * From address when DMARC passed, the envelope sender when SPF passed. Headers from anyone else aren't trusted.
 */
export function allowedSender(email: InboundEmail, allowed: string[]): string | null {
  const results = email.authResults?.trim().toLowerCase() ?? "";
  if (!results.startsWith("mx.cloudflare.net")) return null;
  const ok = new Set(allowed.map((a) => a.trim().toLowerCase()));
  const from = email.from?.toLowerCase();
  if (from && /\bdmarc=pass\b/.test(results) && ok.has(from)) return from;
  const envelope = email.envelopeFrom.toLowerCase();
  if (/\bspf=pass\b/.test(results) && ok.has(envelope)) return envelope;
  return null;
}

/** The email's body for the notes: without quoted replies after "On ... wrote:", or a signature after "-- ". */
export function bodyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((l) => l === "-- " || /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()));
  const kept = (end === -1 ? lines : lines.slice(0, end)).join("\n").trim();
  return kept.length > MAX_NOTES ? `${kept.slice(0, MAX_NOTES)}\n\n(The rest of the email was cut.)` : kept;
}

/** What Claude reads from an email. */
export const EmailTaskSchema = z.object({
  title: z.string().describe("A short task title in the imperative, as the sender would write it in a to-do list"),
  list: z.string().nullable().describe("The name of one of the lists given, exactly, if the email clearly belongs in it; otherwise null for the Inbox"),
  labels: z.array(z.string()).describe("Names of labels given that clearly apply; at most one status label"),
  dueDate: z.string().nullable().describe("YYYY-MM-DD if the email gives a deadline or a day to do it"),
  dueTime: z.string().nullable().describe("HH:MM (24-hour) if it also gives a time on that day"),
  startDate: z.string().nullable().describe("YYYY-MM-DD if it says not to start before a day"),
  priority: z.enum(PRIORITIES).describe("high only if the email says it's urgent or important; otherwise normal"),
});
export type EmailTask = z.infer<typeof EmailTaskSchema>;

/** What Claude is told about Claudia, so it picks from what exists. */
export interface EmailContext {
  today: string;
  timeZone: string;
  lists: string[];
  labels: { name: string; status: boolean }[];
}

/** Reads an email into task fields, or null if it can't. */
export type Extractor = (email: InboundEmail, context: EmailContext) => Promise<EmailTask | null>;

const SYSTEM =
  "You turn an email into one task for a personal task manager. The email was sent to the user's own capture address, " +
  "usually by the user, sometimes forwarding a message from someone else. Write the task the user needs to do: a short " +
  "imperative title (not the subject line verbatim when it's vague, and never a greeting). Choose a list or labels only " +
  "from those given and only when the email clearly calls for them; leave the list null otherwise. Resolve relative dates " +
  "(\"Friday\", \"next week\", \"end of the month\") against today's date in the user's time zone. Leave fields null " +
  "rather than guess.";

/** Reads an email with Claude (Haiku), with structured output. Null on a refusal or an unreadable reply. */
export function claudeExtractor(apiKey: string): Extractor {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  return async (email, context) => {
    const response = await client.messages.parse({
      model: EMAIL_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(EmailTaskSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Today is ${context.today} (${context.timeZone}).`,
            `Lists: ${context.lists.map((l) => JSON.stringify(l)).join(", ") || "(none)"}`,
            `Labels: ${context.labels.map((l) => JSON.stringify(l.name) + (l.status ? " (status)" : "")).join(", ") || "(none)"}`,
            "",
            "<email>",
            `Subject: ${email.subject}`,
            "",
            bodyText(email.text),
            "</email>",
          ].join("\n"),
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output ?? null;
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Turns what Claude read into a task, keeping only lists and labels that exist and dates that are well formed. */
export function taskFromExtract(read: EmailTask, context: EmailContext & { listIds: Map<string, string> }, inboxId: string) {
  const known = new Map(context.labels.map((l) => [l.name.toLowerCase(), l.name]));
  const labelNames = [...new Set(read.labels.map((l) => known.get(l.replace(/^#/, "").toLowerCase())).filter((l): l is string => Boolean(l)))];
  const listId = (read.list && context.listIds.get(read.list.toLowerCase())) || inboxId;
  const due = read.dueDate && DATE.test(read.dueDate) ? read.dueDate : null;
  const dueFields = due && read.dueTime && TIME.test(read.dueTime) ? { dueAt: zonedToUtc(due, read.dueTime, context.timeZone) } : due ? { dueDate: due } : {};
  return {
    listId,
    title: read.title.trim(),
    labels: labelNames,
    priority: read.priority,
    ...dueFields,
    ...(read.startDate && DATE.test(read.startDate) ? { startDate: read.startDate } : {}),
  };
}

export type EmailOutcome =
  | { ok: true; taskId: string; read: "claude" | "quick-add" }
  | { ok: false; reason: "sender" | "no_inbox" | "empty" };

/**
 * Captures an email as a task in the Inbox (or the list Claude picks). The sender must be allowed (`emailSenders`).
 * Claude reads the email when an extractor is given; if it fails or isn't given, the subject is read as quick add.
 * The notes are the email's text, so nothing in it is lost.
 */
export async function captureEmail(db: Db, email: InboundEmail, extract: Extractor | null, now = new Date()): Promise<EmailOutcome> {
  const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, EMAIL_SENDERS_KEY));
  const allowed = Array.isArray(setting?.value) ? setting.value.filter((a): a is string => typeof a === "string") : [];
  if (!allowedSender(email, allowed)) return { ok: false, reason: "sender" };
  const inbox = await findInbox(db);
  if (!inbox) return { ok: false, reason: "no_inbox" };
  const body = bodyText(email.text);
  if (!email.subject && !body) return { ok: false, reason: "empty" };

  const timeZone = await userTimeZone(db);
  const notes = body || null;
  let fields: TaskCreate | null = null;
  if (extract) {
    const [listRows, labelRows] = await Promise.all([
      db.select({ id: lists.id, name: lists.name }).from(lists).where(and(isNull(lists.deletedAt), isNull(lists.archivedAt))),
      db.select({ name: labels.name, statusPosition: labels.statusPosition }).from(labels).where(isNull(labels.deletedAt)),
    ]);
    const context = {
      today: todayIn(timeZone, now),
      timeZone,
      lists: listRows.map((l) => l.name),
      labels: labelRows.map((l) => ({ name: l.name, status: l.statusPosition !== null })),
      listIds: new Map(listRows.map((l) => [l.name.toLowerCase(), l.id])),
    };
    try {
      const read = await extract(email, context);
      if (read?.title.trim()) fields = { ...taskFromExtract(read, context, inbox.id), notes };
    } catch (e) {
      console.error("Reading the email with Claude failed; using quick add", e);
    }
  }
  const outcome = fields ? "claude" : "quick-add";
  fields ??= { listId: inbox.id, notes, ...readCapture(email.subject || body.split("\n")[0]!.slice(0, 200), now, timeZone) };
  const task = await createTask(db, "email", fields);
  return { ok: true, taskId: task.id, read: outcome };
}
