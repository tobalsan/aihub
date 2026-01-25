# Projects API

Projects live in a flat directory (default `~/projects`). Each project is a folder with `README.md` containing YAML frontmatter + markdown body.

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
- File: `README.md`

## Frontmatter fields

```yaml
id: "PRO-1"
title: "My Project"
status: "maybe"           # not_now|maybe|shaping|todo|in_progress|review|done
created: "2026-01-25T13:22:10.123Z"
domain: "coding"          # life|admin|coding
owner: "Thinh"
executionMode: "manual"   # manual|exploratory|auto|full_auto
appetite: "small"         # small|big
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
  "domain": "coding",
  "owner": "Thinh",
  "executionMode": "exploratory",
  "appetite": "small",
  "status": "maybe"
}
```

### Get project
`GET /api/projects/:id`

Returns frontmatter + README body.

### Update project
`PATCH /api/projects/:id`

Body fields are optional:
```json
{
  "title": "New Title",
  "status": "shaping",
  "content": "# New Title\n\nUpdated content.\n"
}
```

If `title` changes, the folder is renamed to match the new slug.
