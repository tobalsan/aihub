# Remove Unused Project Fields

Removed project metadata fields `appetite`, `domain`, `owner`, and `executionMode` from shared schemas, projects extension storage/API/CLI paths, and project board UI references.

Follow-up reviewer cleanup removed Ralph loop creation end-to-end: REST route, CLI command/client helpers, web API helper, runner spawn path, Ralph-specific grouping/display metadata, and related tests/docs.

Added manual migration script:

```bash
node packages/extensions/projects/scripts/strip-deprecated-project-fields.mjs
```

The script scans `~/projects/PRO-*/README.md`, removes those frontmatter keys when present, and logs updated/skipped files.
