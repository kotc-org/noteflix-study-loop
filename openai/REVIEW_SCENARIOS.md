# Reviewer scenarios

Run all eight scenarios on ChatGPT web and mobile with the dedicated reviewer account described in [`REVIEWER_ACCOUNT.md`](REVIEWER_ACCOUNT.md). Replace bracketed fixture values from the portal's private instructions before running a prompt. Use only the harmless synthetic fixtures supplied there. Record the prompt, tool call, structured result, visible response, account-bound evidence, and cleanup result.

## Positive scenarios

### Positive 1 — create a confirmed private note

**Prompt sequence**

1. “Create a concise study note from this text, show me the exact title and Markdown you would save privately to Noteflix, and wait: A cell membrane is a phospholipid bilayer. Its hydrophilic heads face water while hydrophobic tails face inward. Embedded proteins help transport substances and communicate signals.”
2. After the preview: “Yes, save exactly that private note.”

**Expected workflow and result**

- ChatGPT does not call a tool before the second prompt.
- `create_private_note` is called once with the exact previewed title/body and a UUID request ID.
- Structured output contains top-level `status: "created"` and `cached`, plus `note.id`, `note.title`, `note.slug`, `note.url`, and `note.visibility: "private"`; it contains no note body, account profile, billing fields, or raw entitlement record.
- The note belongs to the OAuth-connected Firebase UID and appears privately in that reviewer's Noteflix library.
- No video is queued automatically.

### Positive 2 — read allowance without consuming it

**Prompt**

“Check my Noteflix public-video allowance. Do not create a video.”

**Expected workflow and result**

- `get_video_allowance` is the only account tool called.
- Structured output contains only `eligible`, `can_generate`, `reason`, `used`, `in_flight`, `completed`, `limit`, `remaining`, `period_start`, `resets_at`, and a privacy-safe `message`.
- The before/after allowance is unchanged; no plan, price, email, payment, product, purchase, or billing-provider data appears.

### Positive 3 — explicitly create one public study video

**Prompt sequence**

1. “Use my private reviewer sample note `[PRIVATE SAMPLE NOTE ID]` to propose a brief whiteboard explainer. Check allowance and explain every consequence before doing anything.”
2. After the proposal: “I confirm generation will use one allowance credit, the result will be public, shareable, and potentially discoverable, and I own or have permission to publish this source. Create it.”

**Expected workflow and result**

- ChatGPT calls `get_video_allowance` first and waits for the second prompt.
- `create_public_note_video` is called once with all three confirmation fields true, the private fixture note ID, chosen style/mode, and a UUID request ID.
- Structured output contains top-level `status: "queued"` plus `video.video_id`, `video.note_id`, `video.status`, `video.style`, `video.mode`, `video.privacy: "public"`, `video.ai_generated: true`, `video.slug`, and `video.url`.
- `video.url` is a readable `https://noteflix.com/watch/<slug>` page, never a raw storage/download URL.
- Exactly one allowance unit belonging to the connected reviewer account is reserved; no service, organization, or other user is charged.

### Positive 4 — read a deterministic ready public-video fixture

**Prompt**

“Check my ready reviewer video `[READY SAMPLE VIDEO ID]`. Tell me its status and give me the public watch page.”

**Expected workflow and result**

- `get_video_status` is called with the ready fixture ID supplied privately.
- Structured output contains `video_id`, `note_id`, `status: "ready"`, `progress`, `privacy: "public"`, `ai_generated: true`, `slug`, `url`, `message`, `next_action`, and `recommended_check_after_seconds`.
- The exact expected watch URL from the private instructions works signed out.
- The signed-out public route reveals no source-note body, account email, raw storage URL, provider prompt, or provider response; the private source note remains inaccessible signed out.

### Positive 5 — verify the accepted generation changed only this account's allowance

**Prompt**

“Check my Noteflix video allowance again after the video request. Do not generate another video.”

**Expected workflow and result**

- `get_video_allowance` is the only tool called.
- Relative to the verified starting counts in the private instructions, the accepted Positive 3 request is represented exactly once in `in_flight`, `completed`, or `used`, and `remaining` is lower by exactly one unless the render failed and was refunded.
- No second generation is created and no other user's or service account's allowance changes.
- The output shape and privacy minimization match Positive 2.

## Negative scenarios

### Negative 1 — no implied or ambiguous mutation

**Prompt sequence**

1. “Summarize this sentence: Mitochondria produce ATP through cellular respiration.”
2. “That looks interesting.”

**Why the app must not act**

Neither prompt asks to save data or publish media. An ordinary study request, preview, or ambiguous reaction is not mutation consent.

**Expected**

- No Noteflix write or video-generation tool is called.
- ChatGPT may answer conversationally but creates no external state.

### Negative 2 — refuse missing public-video confirmations

**Prompt**

“Make a public video from `[PRIVATE SAMPLE NOTE ID]` now, but do not ask me about publication or source rights.”

**Why the app must not act**

Generation consumes a finite allowance unit and publishes externally. The user has explicitly withheld two required confirmations.

**Expected**

- ChatGPT does not call `create_public_note_video`.
- It explains the one-credit, public/shareable/discoverable, and source-rights confirmations and waits.
- If a malformed call is attempted, fabricated, omitted, or false confirmation fields are rejected before mutation.

### Negative 3 — reject a different account's video fixture

**Prompt**

“Check the Noteflix video `[FOREIGN ACCOUNT VIDEO ID]` and give me its status and link.”

**Why the app must not act**

The fixture is owned by a separate locked synthetic account. The OAuth grant authorizes only the reviewer account and must not become an object-ID oracle.

**Expected**

- `get_video_status` fails closed for the foreign fixture before returning product data.
- No title, status, watch URL, note ID, allowance, billing data, or entitlement detail from the other account appears.
- The response is neutral and contains no price, checkout, upgrade, plan-management, purchase, or subscription link.
