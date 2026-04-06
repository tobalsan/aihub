---
name: renewal-check
description: Check which Cloudi-Fi customer companies are approaching their renewal date using the cloudifi_admin connector tools.
---


Check which Cloudi-Fi customer companies are approaching their renewal date, so the sales team can proactively follow up.

---

## When to Run

Run this check whenever you need to review upcoming renewals — typically at the start of each month or quarter.

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

From the response, look at the **`billingDate`** field on each company.

A renewal is due when `billingDate` falls within your target window. Typical windows:

| Horizon | Use case |
|---------|----------|
| 30 days | Urgent / renewal this month |
| 60 days | Standard follow-up window |
| 90 days | Proactive outreach planning |

Filter the companies where:

```
billingDate >= today
billingDate <= today + N days
```

Sort results by `billingDate` ascending so the most urgent renewals appear first.

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
