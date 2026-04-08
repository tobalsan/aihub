---
name: renewal-check
description: Check which Cloudi-Fi customer companies are approaching their renewal date using the cloudifi_admin connector tools.
---


Check which Cloudi-Fi customer companies are approaching their renewal date, so the sales team can proactively follow up.

---

## When to Run

Run this check whenever you need to review upcoming renewals — typically at the start of each month or quarter.

**Determining "today":** if the `EVAL_NOW` environment variable is set (format `YYYY-MM-DD`), use it as today's date. Otherwise use the system date. Always anchor every date computation in this skill to that single value.

---

## Process

### Step 1 — Fetch the company list

Use the **list_companies** tool with `extraFields: true` to get the full billing data for every customer.

```
list_companies(extraFields: true)
```

This returns all active companies. Keep the full list — you'll filter it next.

---

### Step 2 — Filter by billing date

From the response, look at the **`billingDate`** field on each company. Skip any company where `billingDate` is missing or null.

A renewal is "in the next N days" when `billingDate` is on or after **today** and on or before **today + N days**. The window is **inclusive at both ends** — both today itself and the day exactly N days from today are kept; day N+1 is excluded.

Apply this exact filter (do not approximate with "this month" or "this quarter" — a 30-day window can straddle two calendar months):

```
keep company if:
  billingDate is not null
  AND billingDate >= today
  AND billingDate <= today + N days        # N=30 means up to and including today+30
```

Common values of N: **30**, **60**, **90**. Use the value the user asked for; if unspecified, default to 30.

For each kept company, compute `daysUntilRenewal = (billingDate - today).days` as a plain integer (0 means renewing today, 30 means the last day still in a 30-day window).

Sort the kept companies by `daysUntilRenewal` ascending so the most urgent renewals appear first.

---

### Step 3 — Present the results

Format the filtered list as a clean table:

| Billing Date | Company ID | Company Name | Country | Max Users | Max Locations |
|---|---|---|---|---|---|
| 2026-04-30 | 461 | Perial | France | 72 | 1 |
| 2026-05-31 | 77 | Credit Agricole - CACD2 | France | 30 | 1 |
| ... | | | | | |

---

### Step 4 — Next steps (optional)

- **Cross-reference in HiveAge**: Match each renewal by company name to the corresponding account in HiveAge (Cloudi-Fi Connections = HiveAge accounts). Check contract terms, last invoice, and any outstanding issues.
- **Draft outreach**: Flag companies that need renewal outreach for the sales team. Note any with high user counts or multiple locations — these may warrant a proactive check-in call.
- **Get per-company details**: If you need more info on a specific company (e.g., quota usage), use `get_company_details(companyIds: [...], extraFields: true)`.

---

## Key Fields

| Field | Source | Notes |
|---|---|---|
| `billingDate` | `list_companies` → company object | The renewal trigger. Format: ISO 8601 string. |
| `id` | `list_companies` → company object | Unique Cloudi-Fi ID |
| `name` | `list_companies` → company object | Company display name |
| `country.name` | `list_companies` → company.country | Country |
| `maxUsers` | `list_companies` → company object | Quota ceiling |
| `maxLocations` | `list_companies` → company object | Location count |

---

## Common Variations

**Change the window mid-session:**
```
What are the renewals in the next 30 days?
What about April renewals only?
```

**Find a specific company:**
```
get_company_details(companyIds: ["461"], extraFields: true)
```

**Check quota usage for a specific period:**
```
get_quota_usage(startDate: "2026-01-01", endDate: "2026-03-31")
```
