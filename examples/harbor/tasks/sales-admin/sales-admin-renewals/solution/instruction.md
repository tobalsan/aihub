# Upcoming renewals — next 30 days

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Using the `cloudifi_admin` connector, list all active customer companies
whose `billingDate` falls within the next **30 days** (inclusive of today,
exclusive of day 31).

## Required output

1. **Final message**: a one-sentence summary of the form
   `Found N company(ies) with renewals in the next 30 days.`

2. **Artifact**: write a JSON file to `/app/out/renewals.json` with the
   schema:

   ```json
   [
     {
       "id": 1001,
       "name": "Acme WiFi Ltd",
       "billingDate": "2026-04-18",
       "daysUntilRenewal": 12
     }
   ]
   ```

   Sorted by `daysUntilRenewal` ascending. `daysUntilRenewal` is the
   integer number of days from `EVAL_NOW` to `billingDate`.

## Rules

- Use `cloudifi_admin.list_companies` to retrieve the data.
- Do not call `create_invoice`, `create_estimate`, or any write endpoint.
- If a company has no `billingDate`, skip it (do not include it).
- Return only the JSON array in the artifact — no extra commentary in
  the file itself.
