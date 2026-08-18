# Repository Agent Instructions

## Mandatory PolinRider Push Gate And Local-First Deployments

<!-- heath-push-deploy-policy:start -->
- Before every `git push` of any branch or tag, run `bash scripts/check-polinrider.sh` from the repository root after the final tracked changes and commits are in place. On Windows, if `bash` resolves to the WSL stub without a working distro, use `C:\Program Files\Git\bin\bash.exe scripts/check-polinrider.sh`. The scan must be the last substantive check before the push; an earlier local result or a GitHub Actions result is not a substitute.
- Treat a missing scanner, a nonzero exit, or any PolinRider/hidden-auto-run finding as a hard stop. Do not push, bypass, weaken, edit around, or disable the gate. Restore the repository's approved `scripts/check-polinrider.sh` first; when bootstrapping a repository that does not yet contain it, run the trusted canonical scanner against the intended push before adding the approved scanner to the repository.
- Prefer deployment directly from the locally verified checkout with the repository's or provider's CLI. Do not commit or push merely to trigger a GitHub Actions deployment when a supported local deployment path is available.
- Use a GitHub Actions deployment only when local deployment is unavailable, the repository explicitly requires the CI-controlled path, or Heath explicitly requests Actions. State the reason when falling back.
- Deploy from the exact reviewed commit/worktree, run the relevant local build or smoke checks, and record the target and result. If deployment creates or changes tracked files, review and commit those changes, then rerun the PolinRider gate immediately before any push.
<!-- heath-push-deploy-policy:end -->
