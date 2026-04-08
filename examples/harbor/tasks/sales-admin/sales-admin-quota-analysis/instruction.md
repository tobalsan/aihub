# Quota analysis — at-risk companies

You are the Sales Admin agent. Treat today's date as **2026-04-06**
(read `EVAL_NOW` from the environment if set).

## Task

Using the `cloudifi_admin` connector, identify all companies whose **user
quota usage is at or above 80%** of their allocated limit.

1. Call `cloudifi_admin.list_companies` to get each company's `maxUsers`
   (the user limit) and `id`.
2. Call `cloudifi_admin.get_quota_usage` with a date range of
   `"2026-04-01"` to `"2026-04-06"` to get current `maxGuest` (active
   users) per company.

A company is **at-risk** when:
```
maxGuest >= maxUsers * 0.8
```

where `maxGuest` comes from the quota report and `maxUsers` comes from
the company listing. Round the threshold down (floor) to an integer.

## Required output

1. **Final message**: a one-sentence summary of the form
   `Found N compan(ies) at or above 80% user quota.`

2. **Artifact**: write a JSON file to `/app/out/quota_analysis.json` with
   the schema:

   ```json
   [
     {
       "id": 1001,
       "name": "Acme WiFi Ltd",
       "maxUsers": 500,
       "maxGuest": 412,
       "usagePercent": 82
     }
   ]
   ```

   Sorted by `usagePercent` descending (highest usage first).
   `usagePercent` is `Math.round((maxGuest / maxUsers) * 100)`.

## Rules

- Use only `cloudifi_admin.list_companies` and
  `cloudifi_admin.get_quota_usage`.
- Do not call `create_invoice`, `create_estimate`, or any write endpoint.
- Skip companies where `maxGuest` is null or `maxUsers` is 0.
- Return only the JSON array in the artifact — no extra commentary in
  the file itself.
