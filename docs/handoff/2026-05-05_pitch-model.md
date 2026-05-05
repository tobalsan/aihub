# Pitch/Specs Doc Model

Project prose now lives in `PITCH.md`. Project `README.md` stays on disk as the YAML frontmatter carrier, and legacy project-level `SPECS.md` files are left untouched but no longer surfaced in project detail.

Slice prose now lives in `SPECS.md`. Slice `README.md` stays on disk as the YAML frontmatter carrier; `TASKS.md`, `VALIDATION.md`, and `THREAD.md` keep their existing slice tabs.

Legacy fallback is non-destructive: projects without `PITCH.md` render the stripped `README.md` body as Pitch, and slices without `SPECS.md` render the stripped `README.md` body as Specs. Editing those tabs writes the new target file and leaves the old `README.md` body alone.

Migration helpers:

- `aihub projects pitch <PRO-N> --from-readme [--force]`
- `aihub slices specs <PRO-N-S0X> --from-readme [--force]`

Both helpers copy the stripped `README.md` body into the new target and refuse to overwrite unless `--force` is passed.
