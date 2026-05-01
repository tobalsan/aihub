# Project Selection Locality

- Kept embedded `ProjectsOverview` detail actions local to its right pane.
- Board canvas now normalizes legacy `projects:detail` state back to `projects` so stale persisted canvas state cannot remount the Projects tab.
- Added focused web tests for embedded row selection and embedded detail actions not calling parent navigation.
