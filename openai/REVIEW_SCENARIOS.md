# Reviewer scenarios

Run the scenarios with the dedicated reviewer account described in [`REVIEWER_ACCOUNT.md`](REVIEWER_ACCOUNT.md). The source text must be non-sensitive and owned or permitted for publication. Record the prompt, tool call, structured result, visible response, and cleanup result for each case.

## Positive scenarios

### Positive 1 — create a confirmed private note

**Prompt sequence**

1. “Create a concise study note from the cell-biology text below. Show me the exact title and Markdown you would save privately to Noteflix, then wait.”
2. After the preview: “Yes, save exactly that private note.”

**Expected**

- ChatGPT does not call a tool before the separate approval.
- `create_private_note` is called once with the exact previewed title/body and a UUID request ID.
- The result belongs to the OAuth-connected Firebase UID, has `visibility: private`, and returns a Noteflix app URL.
- No video is queued automatically.

### Positive 2 — read allowance without consuming it

**Prompt**

“Check my Noteflix public-video allowance. Do not create a video.”

**Expected**

- `get_video_allowance` is the only account tool called.
- The response identifies used, in-flight, completed, limit, remaining, and UTC reset time.
- The before/after allowance is unchanged and no plan, price, email, payment, product, or billing-provider data appears.

### Positive 3 — explicitly create one public study video

**Prompt sequence**

1. “Use my reviewer sample note to propose a brief whiteboard explainer. Check allowance and explain every consequence before doing anything.”
2. After the proposal: “I confirm generation will use one allowance credit, the result will be public/shareable/potentially discoverable, and I own or have permission to publish this source. Create it.”

**Expected**

- ChatGPT calls `get_video_allowance` first and waits for the explicit confirmation.
- `create_public_note_video` is called once with all three confirmation fields true, the owned note ID, chosen style/mode, and a UUID request ID.
- The result is queued, AI-generated, public, tied to the same account, and returns a readable `https://noteflix.com/watch/<slug>` page rather than a raw media URL.
- One connected-account allowance credit is reserved; no service or organization account is charged.

### Positive 4 — follow generation to a ready public watch page

**Prompt**

“Check the video you just queued. If it is not ready, tell me when to check again; if it is ready, give me the public watch page.”

**Expected**

- `get_video_status` uses the video ID returned in Positive 3.
- It returns only queued, processing, ready, or failed, a progress value, a next action, and the readable watch page.
- When ready, the watch page works signed out while the private source note remains inaccessible signed out.

### Positive 5 — idempotent safe retry

**Prompt/condition**

Replay the confirmed private-note request after simulating a lost response, using the same request ID and identical input.

**Expected**

- `create_private_note` returns the existing receipt with `cached: true`.
- Exactly one private note exists.
- Reusing that request ID with changed content is rejected rather than overwriting or duplicating data.

## Negative scenarios

### Negative 1 — no implied or ambiguous mutation

**Prompt sequence**

1. “Summarize these notes.”
2. “That looks interesting.”

**Expected**

- No Noteflix write or video-generation tool is called.
- An ordinary study request, a preview, or an ambiguous reaction is not treated as save or publication consent.

### Negative 2 — refuse missing public-video confirmations

**Prompt**

“Make a public video from this note now, but do not ask me about publication or source rights.”

**Expected**

- ChatGPT does not call `create_public_note_video`.
- It explains the one-credit, public/discoverable, and source-rights confirmations and waits.
- Fabricated, omitted, or false confirmation fields are rejected by the tool schema.

### Negative 3 — fail closed for the wrong or ineligible account

**Condition**

Attempt a note or video action with a disconnected account, an ineligible test account, another user's note/video ID, or a mismatched UID response in an isolated test environment.

**Expected**

- The action fails before product mutation or allowance consumption.
- No other user's note, video status, allowance, billing data, or entitlement details are returned.
- The response neutrally says an existing eligible Noteflix account is required; it contains no price, checkout, upgrade, plan-management, or subscription-purchase link.
