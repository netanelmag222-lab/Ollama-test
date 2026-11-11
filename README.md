# Morning Checks v2 (SPFx)

A SharePoint web part for daily system checks. Each check moves through NOC → System owner → System admin, each system has a report folder, and a daily summary goes out by email.

## Install (about 15 minutes)

1. Build the package with `npm install` and `npm run build`. The output is `sharepoint/solution/morning-checks-v2.sppkg`.
2. Upload the `.sppkg` to the tenant App Catalog and click **Deploy**.
3. On the target site, open a page, add the **Morning Checks v2** web part, and publish.
4. As a site owner, open the page and click **Create lists now**.
5. Fill in the **MC_Systems** list (click **Edit systems**). Each system needs a **System key**, which is also its folder name, plus a **System owner** and a **System admin**.
6. Edit the web part and set **Summary recipients**.
7. Reload the page. Click **Create lists now** again to create the folders for the new systems. It is safe to run more than once.

This app does not replace the old `morning-checks` app (v1.0.2.0), and v1's data in `MorningChecksAppData` is not touched. Both can run side by side while you test. To roll back, remove the v2 web part from the page.

## What it creates

| Name | Type | Purpose |
|---|---|---|
| `MC_Systems` | List | One item per system: key, group, critical, owner, admin, and what to check |
| `MC_DailyChecks` | List | One item per system per day (`Title` = `yyyy-mm-dd\|key`, unique): status, stage, assignee, notes, history |
| `MC_Reports` | Library | One folder per system key. Report files go here |

Version history is turned on for all three, so every change is recorded with who made it and when.

## Daily flow

1. NOC clicks **Start day**. This creates today's items.
2. NOC uploads each report with **Upload report**. Text reports (`csv`, `txt`, `log`, `htm/html`, `json`, `xml`) are scanned for error and warning lines, and the page suggests a status.
3. NOC sets the status: OK, Warning, Fail, or N/A. A system with no decision and no report shows **Missing report** and never counts as OK.
4. For a Fail or Warning, **Escalate** assigns the check to the System owner, and the next escalation assigns it to the System admin. **Close** ends it.
5. **Send summary** emails the day's table to the recipients.

## Design rules

- **One item per system per day, saved with ETag.** If two people edit the same item, the second save is rejected (HTTP 412). The page reloads and asks the person to apply the change again, so nobody's work is silently overwritten.
- **A unique `Title` prevents duplicate daily items**, even when two people click **Start day** at the same moment.
- **Unknown never counts as OK.** The day is healthy only when every check was explicitly marked OK or N/A.

## Not done yet

- **Permissions are not locked down per stage.** This is option A: the NOC, System, and Admin groups all get Contribute, and version history provides the audit trail. Allowing only the current assignee to edit needs item-level permissions, set by a Power Automate flow.
- **No notification to the new assignee on escalation.** Add a Power Automate flow on `MC_DailyChecks` that runs when `Stage` changes.
- **The v1 report parsers (vCheck, NetApp, AdAudit, and others) are not ported.** The generic error and warning scan replaces them for now.
- **The summary is sent by hand.** A scheduled flow can send it automatically.
- **Email uses SharePoint's `SendEmail`.** It only reaches people in your organization.

## Develop

```bash
npm install
npm run build      # lint + unit tests + package
npm start          # local workbench
```

Pure logic (statuses, escalation, scanning, summary) lives in `src/webparts/morningChecks/logic/model.ts` and is unit-tested. SharePoint REST calls live in `logic/sp.ts`.
