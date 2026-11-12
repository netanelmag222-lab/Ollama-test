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
