# Capture to the Inbox from an iPhone Shortcut

`POST /api/capture` adds a task to the Inbox from one line of text, read as quick add reads it:

- `#labels` become labels; missing ones are created.
- A date or time at the end becomes the due date: "tomorrow", "fri", "next week", "3pm", "mon 9:30am", "12 Nov".
- `notes` is optional. The share sheet can use it for a URL.

```http
POST https://claudia.alphajuliet.com/api/capture
Authorization: Bearer cl_…
X-Claudia-Client: shortcut
Content-Type: application/json

{ "text": "Return library books #errand tomorrow", "notes": null }
```

It answers `201` with the task. The Inbox is the live, unarchived list named "Inbox" (any case). Without one, it answers `422` (`no_inbox`).

## Token

Use a `write` token of its own, so it can be revoked without signing anything else out:

```sh
npm run token:create -w @claudia/worker -- --remote --name shortcut --scopes write
```

## Build the Shortcut

In the Shortcuts app, make a new shortcut called **Add to Claudia**:

1. **Ask for Input**: Text, prompt "Task".
2. **Get Contents of URL**:
   - URL `https://claudia.alphajuliet.com/api/capture`, Method **POST**.
   - Headers: `Authorization` = `Bearer cl_…` (the token), `X-Claudia-Client` = `shortcut`.
   - Request Body **JSON**: `text` (Text) = *Provided Input*.
3. **Get Dictionary Value**: `title` from *Contents of URL*.
4. **If** *Dictionary Value* has any value: **Show Notification** "Added *Dictionary Value*". **Otherwise**: **Show Notification** "Couldn't add the task" with *Contents of URL* (which holds the error message).

Ways to run it:

- **Siri:** "Add to Claudia", then say the task, such as "call the plumber tomorrow 9am".
- **Home Screen:** add the shortcut as an icon or widget.
- **Lock Screen widget**, **Action button** or **Back Tap** (Settings › Accessibility › Touch › Back Tap).

## From the share sheet (optional)

To save a page or text from another app:

1. In the shortcut's details, turn on **Show in Share Sheet** and accept **URLs** and **Text**.
2. Before step 1, add **If** *Shortcut Input* has any value:
   - **Ask for Input**: Text, prompt "Task", default answer *Shortcut Input › Name*.
   - Put *Shortcut Input* in the request body as `notes`.
3. Keep the plain Ask for Input in **Otherwise**, for Siri and the Home Screen.
