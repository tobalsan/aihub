# Projects API

Projects live in a flat directory (default `~/projects`). Each project is a folder with `README.md` for YAML frontmatter and `PITCH.md` for the user-facing pitch body. Legacy projects without `PITCH.md` fall back to the stripped `README.md` body when read.

## Config

`~/.aihub/aihub.json`:

```json
{
  "projects": { "root": "~/projects" }
}
```

## Storage

- Counter: `~/.aihub/projects.json` (`{ "lastId": N }`)
- Folder: `PRO-<n>_<slug>` (slug from title, lowercase, `_` separators)
- Frontmatter file: `README.md`
- Pitch file: `PITCH.md`

## Frontmatter fields

```yaml
id: "PRO-1"
title: "My Project"
status: "maybe"           # not_now|maybe|shaping|todo|in_progress|review|done
created: "2026-01-25T13:22:10.123Z"
area: "aihub"
repo: "~/code/aihub"
```

## Endpoints

### List projects
`GET /api/projects`

Returns frontmatter only (no README body).

### Create project
`POST /api/projects`

Body:
```json
{
  "title": "Project Mgmt API",
  "pitch": "Pitch body.",
  "status": "maybe",
  "area": "aihub"
}
```

Only `title` is required. Omitted optional frontmatter fields are left unset; omitted pitch creates an empty `PITCH.md`.

### Get project
`GET /api/projects/:id`

Returns frontmatter + pitch body.

### Update project
`PATCH /api/projects/:id`

Body fields are optional:
```json
{
  "title": "New Title",
  "status": "shaping",
  "content": "# New Title\n\nUpdated pitch.\n"
}
```

If `title` changes, the folder is renamed to match the new slug.
