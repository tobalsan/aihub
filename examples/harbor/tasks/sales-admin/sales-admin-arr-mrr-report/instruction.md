# ARR/MRR report

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Generate the ARR/MRR report for **2026-Q1**.

Use `cloudifi_admin.list_companies` with `extraFields: true` to retrieve
company billing data. For this task, each company fixture includes a
`monthlyRate` that is only available in the extra-fields payload.

- `mrr` = sum of all company `monthlyRate` values
- `arr` = `mrr * 12`
- `by_company` = list of `{ id, name, mrr }` sorted by `mrr` descending

## Required output

1. **Artifact (REQUIRED)**: Use the `write` tool to create
   `/app/out/arr-mrr.json` containing a JSON object with:
   - `arr`: number (mrr × 12)
   - `mrr`: number (sum of monthly rates)
   - `by_company`: array of `{ id, name, mrr }` sorted by mrr descending

2. **Final message**: a one-sentence summary mentioning the MRR and ARR totals.

## Rules

- You MUST write the JSON file using the `write` tool before finishing.
- Use `cloudifi_admin.list_companies` for data.
- Do not call `create_invoice`, `create_estimate`, or any write endpoint
  on cloudifi_admin.
