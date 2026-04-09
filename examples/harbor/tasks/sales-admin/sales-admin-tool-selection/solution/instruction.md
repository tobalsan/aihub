# Sales-admin tool selection

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Answer these three requests by choosing the correct `cloudifi_admin`
tool for each:

1. `How are we doing this quarter?`
2. `What's coming up for renewal?`
3. `Can you pull up details on company 1001?`

## Rules

- Use the sales-admin connector tools directly.
- For quota/quarter usage, use `cloudifi_admin.get_quota_usage`.
- For renewals, use `cloudifi_admin.list_companies`.
- For specific company detail lookup, use
  `cloudifi_admin.get_company_details`.
- Do not call write tools.

No artifact file is required for this task. Verifier inspects
`/logs/agent/result.json`.
