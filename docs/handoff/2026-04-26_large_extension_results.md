# Large Extension Results

Updated container Pi extension tools to materialize large gateway tool results as JSON files under `/workspace/data/tool-results/` once the serialized result exceeds 20KB. The model now receives a compact file path plus preview, while history/debug `details` still retain the original result.

This was motivated by Sally's Google Sheets verification flow: large `gsheets_read_sheet` results were being pasted into shell heredocs, causing quoting/EOF failures and partial manual analysis. Sally's `sheet-verification` skill now tells agents to pass the returned tool-result file path directly to `verify_sheet.py --sheet-json`.

The external `aihub-extensions` Google Sheets extension also gained `rowOffset`, `maxRows`, and `columns` parameters on `gsheets_read_sheet` so agents can request smaller projected pages when they do not need a full tab.
