# Renewal estimate preview

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Build a renewal estimate preview for company **ACME-42 Corp** for the
next billing period.

1. Use `cloudifi_admin.list_companies` or
   `cloudifi_admin.get_company_details` with `extraFields: true` to find
   the company record, because pricing fields are only present in the
   extra-fields payload.
2. Use `cloudifi_admin.get_quota_usage` with a date range of
   `"2026-04-01"` to `"2026-04-06"` to get current usage.
3. Compute the preview line items:
   - base subscription = `monthlyRate`
   - overage = `max(0, maxGuest - maxUsers) * overagePerUser`

For this task, the pricing fields come from the company fixture:
`planName`, `monthlyRate`, and `overagePerUser`.

## Required output

1. **Artifact (REQUIRED)**: Use the `write` tool to create
   `/app/out/renewal_estimate.json` containing a JSON object with:
   - `companyId`: number
   - `companyName`: string
   - `billingDate`: string
   - `lineItems`: array of objects with `type`, `description`, `quantity`,
     `unitPrice`, `amount`
   - `total`: sum of line-item amounts

2. **Final message**: a one-sentence summary mentioning the company name
   and the total amount.

## Rules

- You MUST write the JSON file using the `write` tool before finishing.
- Use only read-only cloudifi_admin tools for data retrieval.
- Do not call `create_estimate`, `create_invoice`, or any write endpoint
  on cloudifi_admin.
- Return exact numeric amounts derived from the fixture data.
