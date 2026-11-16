# Capture to the Inbox by email

Mail to **`inbox@claudia.alphajuliet.com`** becomes a task. Cloudflare Email Routing receives it for the `claudia.alphajuliet.com` subdomain and hands it to the Worker's `email` handler (`worker/src/index.ts`, with the rules in `worker/src/domain/email.ts`). Mail for `alphajuliet.com` itself still goes to iCloud: only the subdomain's MX records point at Cloudflare.

## What happens to an email

1. **Size:** anything over 5 MB is rejected.
2. **Sender:** it must come from an address in the `emailSenders` setting, and that address must be authenticated. Cloudflare records its checks in the first `Authentication-Results` header (from `mx.cloudflare.net`). The From address counts when DMARC passed; the envelope sender counts when SPF passed. Anything else is rejected with "This address doesn't take mail from you". Cloudflare has already turned away mail that fails both SPF and DKIM.
3. **Reading it:** Claude (`claude-haiku-5-5`, low effort, structured output) reads the subject and text into a title, a list, labels, a due date or time, a start date and a priority. It's given today's date, your time zone, and the names of your lists and labels. Lists and labels it names that don't exist are dropped, and so are malformed dates. With no list, the task goes to the Inbox.
4. **Fallback:** if Claude isn't set up (no `ANTHROPIC_API_KEY`), fails or declines, the subject is read as quick add (`#labels` and a trailing date, as the iPhone Shortcut does) into the Inbox. With no subject, the first line of the text is used.
5. **Notes:** the email's text, without a signature (after `-- `) or the quoted message in a reply (from "On … wrote:"), up to 20,000 characters.
6. The task is created with actor `email` in the event log. An API caller can't claim that actor.

If there's no Inbox list, or the email has neither a subject nor text, it's rejected and the sender gets a bounce saying why. The Worker logs every capture and rejection (Workers & Pages › claudia › Logs).

## Setting it up

These are done once, in the Cloudflare dashboard and the terminal.

1. **Email Routing on the subdomain.** Dashboard › alphajuliet.com › Email › Email Routing. Under Settings, add the subdomain `claudia.alphajuliet.com` and let it add its MX and TXT records. Don't enable Email Routing for `alphajuliet.com` itself, which would replace the iCloud MX records.
2. **The route.** Email Routing › Routing rules › Create address: custom address `inbox@claudia.alphajuliet.com`, action **Send to a Worker**, Worker **claudia**.
3. **Claude.** Add an Anthropic API key as a Worker secret. Without it, emails are still captured, read as quick add.

   ```sh
   cd worker && npx wrangler secret put ANTHROPIC_API_KEY
   ```

4. **Allowed senders.** Set the addresses that may add tasks (any case):

   ```sh
   curl -X PUT https://claudia.alphajuliet.com/api/settings/emailSenders \
     -H "Authorization: Bearer $(cat ~/.config/claudia/write-token)" \
     -H "Content-Type: application/json" \
     -d '{"value": ["you@example.com", "you@work.example"]}'
   ```

## Sending from iCloud as claudia+inbox@alphajuliet.com

iCloud handles `alphajuliet.com`, so Cloudflare can't receive `claudia+inbox@alphajuliet.com` directly. To use that address, add an iCloud Mail rule that forwards mail sent to it on to `inbox@claudia.alphajuliet.com`. I haven't tested how iCloud sets the sender on forwarded mail. If such mail bounces, the Worker's log line "Email from … not captured: sender" shows the envelope address, which can be added to `emailSenders`.

## Cost

Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. A typical email is well under a thousand tokens in and a hundred out: about a hundredth of a cent each.
