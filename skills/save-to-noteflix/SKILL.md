---
name: save-to-noteflix
description: Saves study content supplied as text in the user's current request, or the resulting draft created from that text, to the user's connected Noteflix account as a private note. Use only when the user explicitly asks to save, create, send, or store a note in Noteflix. Never use for an ordinary organize, practice, quiz, or planning request, and never use for video, audio, image, or other media generation.
---

# Save to Noteflix

Save an explicitly approved study artifact to the learner's Noteflix account as a private note.

## Trigger gate

Proceed only when the learner explicitly asks to save, create, send, or store the material in Noteflix. A request to organize notes, make practice, run a quiz, or build a plan does not imply permission to save. Suggestions, likely usefulness, prior saves, and an existing Noteflix connection do not count as permission.

## Prepare the note

1. Use only source text supplied in the learner's current request and the draft produced from that text in the current interaction. Do not inspect uploads, prior conversations, Claude memory, connectors, a Noteflix library, or any other source.
2. Read [learning integrity and source handling](../../references/learning-integrity.md).
3. Build a concise title and an exact Markdown body. Preserve the learner's meaning and do not add facts that were not in the approved artifact.
4. Include `summary` or `key_points` only when those fields are already explicit in the artifact or the learner requests them. Do not infer sensitive attributes or add personal identifiers.
5. Create a fresh UUID as `request_id`. Keep that same UUID for a retry of the same confirmed payload. If any field changes, create a new UUID only after the changed payload is confirmed.

## Required confirmation

Before calling any tool, show a save preview that identifies every field that will be sent:

- destination: Noteflix;
- privacy: private;
- exact title;
- exact Markdown content;
- exact summary and key points, if present; and
- the fact that a technical idempotency request ID will be included.

Then ask: “Save this as a private Noteflix note?” Stop and wait for a clear affirmative response. Do not treat the original save request, silence, an ambiguous reply, or a request to edit the preview as confirmation. If the learner changes any field, show the revised preview and ask again.

## Create and report

1. After confirmation, call the Noteflix MCP tool `create_private_note` exactly once with `title`, `content_markdown`, optional `summary`, optional `key_points`, and `request_id`.
2. Never change the privacy fields or attempt a public save. The tool creates private notes only.
3. On success, report the returned title and private Noteflix app link. Do not claim that Noteflix created flashcards, quizzes, videos, audio, images, or any other derived asset.
4. If authentication is required, explain that the learner must connect Noteflix through OAuth, then retry only after authentication and with the same confirmed payload and `request_id`.
5. If the result is uncertain or the call times out, do not issue a new request ID. Retry the same request at most once so idempotency can prevent duplicates, then report the uncertainty.

## Boundaries

- Never save automatically or in the background.
- Never call another Noteflix tool. This submitted plugin supports only `create_private_note`.
- Never request, create, check, or link to AI-generated video, audio, or image media.
- Never imply access to existing Noteflix notes, study activity, uploads, connected services, or account data beyond the authenticated identity needed to create the private note.
- Do not save direct answers to a live, proctored, or graded assessment.
