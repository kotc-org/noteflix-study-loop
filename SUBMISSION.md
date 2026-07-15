# Claude plugin submission metadata

## Listing

- **Plugin name:** Noteflix Study Loop
- **Plugin ID:** `noteflix-study-loop`
- **Version:** `0.2.0`
- **Tagline:** Study what you supplied—not what the model guesses.
- **Category:** Education
- **Publisher:** Noteflix
- **Intended audience:** Adults and higher-education learners; not users under 18 or K–12 student deployment
- **Supported platforms:** Claude Cowork and Claude Code
- **Website:** https://noteflix.com
- **Support:** support@noteflix.com
- **Repository:** https://github.com/kotc-org/noteflix-study-loop
- **Privacy policy:** https://github.com/kotc-org/noteflix-study-loop/blob/main/PRIVACY.md
- **Support page:** https://github.com/kotc-org/noteflix-study-loop/blob/main/SUPPORT.md

## Short description

Turns user-supplied study text into source-faithful guides, practice, quiz-first review, and study plans, then explicitly saves approved results as private notes in Noteflix.

## Full description

Noteflix Study Loop helps adult and higher-education learners turn text supplied in the current Claude request into an active review workflow. It organizes messy notes into source-faithful guides, creates flashcards and direct source-clause practice questions, leads one-question-at-a-time review, and builds realistic review plans from a deadline and available time.

When a learner explicitly asks to save an artifact, the plugin shows the exact title, Markdown content, optional summary and key points, destination, and private visibility. It then asks for a separate confirmation. Only after an affirmative response does the plugin use the authenticated `create_private_note` tool to create a private note in the learner's real Noteflix account and return its in-app link.

The plugin does not inspect uploads, retrieve prior conversations, query Claude memory, access other connectors, or search existing Noteflix content. Study source material must be supplied as text in the current request. It is not designed for users under 18 or K–12 student deployment.

## Example use cases

1. Organize pasted lecture text into a concise, source-faithful study guide and flag contradictions.
2. Create flashcards and direct retrieval questions from a pasted chapter excerpt, with every back and answer separated at the end.
3. Run an eight-question, one-at-a-time review that adapts to the learner's answers.
4. Build a time-bounded review plan from pasted topics, learner-reported weak areas, a deadline, and available minutes.
5. Preview, confirm, and save the resulting artifact as a private note in the learner's connected Noteflix account.

## Permissions and data statement

- **Authentication:** OAuth with PKCE through Noteflix.
- **Requested OAuth scopes:** `notes:create` and `offline_access`. `notes:create` is the sole data-action scope; `offline_access` permits refresh-token renewal and adds no Noteflix data access.
- **Remote tool:** `create_private_note` only.
- **Mutation:** Creates one private Noteflix note after explicit intent, exact-payload preview, and separate confirmation.
- **Data sent:** Confirmed title, Markdown content, optional confirmed summary/key points, random idempotency request ID, and authenticated account identity.
- **Existing data access:** None. The tool cannot list, read, search, update, publish, or delete existing notes.
- **Media:** No AI video, audio, image, podcast, or other media-generation tool is exposed or invoked. Saving through this integration does not start derived-media generation.
- **Other sources:** The plugin does not access uploads, prior chats, Claude memory, calendars, learning-management systems, storage providers, or other connectors.

Full retention and deletion details are in `PRIVACY.md`. Learners can delete notes or their account from https://noteflix.com/noteflix-settings and can revoke the connection in Claude.

## Reviewer instructions

1. Clone the public repository and run `claude plugin validate --strict .`.
2. Start Claude with `claude --plugin-dir .` or install through the plugin review environment.
3. Paste the content of `samples/cell-biology-notes.md` into the current request and run the functional cases in `REVIEW_CHECKLIST.md`.
4. Connect the dedicated, fully populated Noteflix reviewer account through the normal OAuth flow. Credentials and step-by-step access instructions are supplied privately to the review team and are never stored in this repository.
5. Ask Claude to save the generated study guide to Noteflix. Confirm that Claude first displays the exact private-note payload and stops.
6. Reply affirmatively. Confirm that exactly one private note is created and that Claude returns its private Noteflix app link.
7. Run the negative cases: ordinary study requests do not save; an edit requires a new preview and confirmation; a declined save makes no call; no video or media-generation tool is available.

Detailed expected behavior is in `REVIEW_CHECKLIST.md`.
