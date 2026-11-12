# v1 package patch (1.0.2.0 -> 1.0.3.0)

`patch-v1-sppkg.py` patches the original `morning-checks-4.sppkg` in place. The ProductID stays the same, so SharePoint upgrades the existing app. Data in `MorningChecksAppData` is kept.

```bash
mkdir v103 && cd v103 && unzip ../morning-checks-4.sppkg && cd ..
python3 -I tools/patch-v1-sppkg.py v103
cd v103 && zip -X -D ../morning-checks-1.0.3.0.sppkg $(unzip -Z1 ../morning-checks-4.sppkg | sed 's/03911e399acdc6e88a25/<new hash printed by the script>/')
```

Fixes:
1. Saves and deletes send the item version as `IF-MATCH` instead of `*`. A save that would overwrite someone else's newer save is refused (HTTP 412), and the user sees a Hebrew message telling them to refresh.
2. Replacing data from a JSON file asks for confirmation first, showing how many days will be deleted from SharePoint.
3. A report with no readable report time gets a "זמן הדוח לא זוהה" (low) finding, so it is no longer treated as fresh.
4. The JS asset is renamed, so browsers and the CDN load the new version.

# Escalation (1.0.3.0 -> 1.0.4.0)

`patch-v1-escalation.py` adds the NOC → system team → system admin workflow to the extracted 1.0.3.0 package:

```bash
python3 -I tools/patch-v1-escalation.py v103   # the folder becomes 1.0.4.0
node tools/test-v1-escalation.js v103/ClientSideAssets/*.js   # browser test with mocked SharePoint
```

- **Each system card has an "הסלמה" (escalation) box.** For a card marked "קיימות התראות", the next button moves it from NOC to the system owner, then to the system admin. Further buttons: "סמן כטופל" closes it and "פתח מחדש" reopens it. Each step asks for an optional note and is saved in `manual[sysId].esc.hist` with the time and the user.
- **New "מנהל מערכת ראשי" field** in the system catalog, under "פרטים". It is the stage 3 assignee.
- **New status filters:** "בהסלמה" (escalated) and "מוקצה אליי" (assigned to me, matched by the SharePoint display name).
- **Banner for earlier days.** Open escalations from previous days appear at the top of the analysis view, with a button to open that day.
- **Card header and report show a tag** such as "⬆️ צוות מערכת: name".

Limits: anyone who can edit the list can escalate (no roles). There is no Teams or email notification. Matching "assigned to me" depends on the names in the catalog matching SharePoint display names.
