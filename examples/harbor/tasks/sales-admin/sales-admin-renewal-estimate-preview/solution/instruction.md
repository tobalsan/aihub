# Renewal estimate preview

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Build a renewal estimate preview for company **ACME-42 Corp** for the
next billing period.

1. Use `cloudifi_admin.list_companies` or
   `cloudifi_admin.get_company_details` to find the company record.
2. Use `cloudifi_admin.get_quota_usage` with a date range of
   `"2026-04-01"` to `"2026-04-06"` to get current usage.
3. Compute the preview line items:
   - base subscription = `monthlyRate`
   - overage = `max(0, maxGuest - maxUsers) * overagePerUser`

For this task, the pricing fields come from the company fixture:
`planName`, `monthlyRate`, and `overagePerUser`.

## Required output

1. **Final message**: a one-sentence summary of the form
   `Prepared renewal estimate preview for ACME-42 Corp totaling 404.00.`

2. **Artifact**: write a JSON file to `/app/out/renewal_estimate.json`
   with the schema:

   ```json
   {
     "companyId": 1042,
     "companyName": "ACME-42 Corp",
     "billingDate": "2026-05-01",
     "lineItems": [
       {
         "type": "base_subscription",
         "description": "Business Pro base subscription",
         "quantity": 1,
         "unitPrice": 299.0,
         "amount": 299.0
       }
     ],
     "total": 404.0
   }
   ```

## Rules

- Use only read tools.
- Do not call `create_estimate`, `create_invoice`, or any write endpoint.
- Return exact numeric amounts derived from the fixture data.
- Return only JSON in the artifact.
