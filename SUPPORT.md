# Support

The four study skills require no Noteflix account. Saving a private note requires an active eligible Noteflix subscription and an OAuth connection; learners do not need an API key or environment variable.

## Before reporting a problem

1. Confirm the plugin passes `claude plugin validate --strict .` from the repository root.
2. Paste the relevant source text into the current request. The plugin does not inspect uploads, prior conversations, memory, connectors, or existing Noteflix content.
3. For a save problem, confirm that Noteflix is connected through OAuth, that the `notes:create` permission was granted, and that the connected account shows an active paid or trial subscription in Noteflix. If a purchase was recently restored, complete the restore/sync flow in Noteflix before retrying with the same request ID.
4. Confirm that Claude displayed the full private-note preview and received a separate affirmative response before the tool call.
5. If a request timed out, do not repeatedly submit it with new IDs; the skill reuses the original request ID to prevent duplicates.
6. Include the Claude surface and version, plugin version, skill used, approximate timestamp, and observed error. Remove note content and personal details from the report.

To stop future saves, revoke the Noteflix connection from Claude's connector settings. Manage notes or delete the account from [Noteflix settings](https://noteflix.com/noteflix-settings).

## Contact

- Email: [support@noteflix.com](mailto:support@noteflix.com)
- Website: [https://noteflix.com](https://noteflix.com)
- Privacy: [https://noteflix.com/privacy](https://noteflix.com/privacy)
- Repository issues: [https://github.com/kotc-org/noteflix-study-loop/issues](https://github.com/kotc-org/noteflix-study-loop/issues)

Do not include private course records, note bodies, credentials, OAuth tokens, personal identifiers, or proprietary source material in a public issue.
