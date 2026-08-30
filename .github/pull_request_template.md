## Summary

<!-- What changed and why. If this fixes a bug, state what the user actually saw. -->

## Documentation

<!-- Required: see "Every PR Ships Its Documentation" in CLAUDE.md.
     Both files, in the same PR as the code — templates in documents/README.md. -->

- [ ] `documents/<task-ID>-<short-name>/implementation.md` — the failure, the root cause,
      why this approach, what was rejected, what's deliberately narrow, what's left out
- [ ] `documents/<task-ID>-<short-name>/release.md` — user-visible change, files touched,
      migrations, env vars, deploy order, how to verify, known issues
- [ ] Index row added to `documents/README.md`
- [ ] `CLAUDE.md` updated if this adds a router, migration, table, or frontend page

<!-- Docs-only, typo, or comment-only change? Delete this section and say so here. -->

## Verification

<!-- What you actually ran, and its actual result. If something couldn't be run in your
     environment, say so and say what you did instead — never imply a check that didn't
     happen. -->

## Deployment notes

<!-- Migrations to apply, deploy ordering between backend/bot/frontend, new env vars.
     "None" is a fine answer. -->
