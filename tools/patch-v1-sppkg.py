import sys,glob,hashlib,os,re
root=sys.argv[1]
js=glob.glob(root+'/ClientSideAssets/*.js')[0]
s=open(js,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    n=s.count(old); assert n==count, (n,old[:80]); s=s.replace(old,new)
# 1. load the item version so saves can use it as ETag
rep("?$select=Id,Title,CheckDate,Checker,Score,WindowHours,AlertCount,FileErrors,Summary,Payload&",
    "?$select=Id,Title,owshiddenversion,CheckDate,Checker,Score,WindowHours,AlertCount,FileErrors,Summary,Payload&")
# 2. clear message on conflict (HTTP 412)
rep("  if (!response.ok) {\n    let detail='';",
    "  if (response.status === 412) throw new Error('מישהו אחר שמר שינויים בזמן שעבדת. רענן את הדף (F5) והזן שוב את השינוי האחרון. השינוי שלך לא נשמר.');\n  if (!response.ok) {\n    let detail='';")
# 3. ETag helper + delete with version
rep("async function deleteItem(item) {\n  if(!item)return;\n  await spCall(`${listEndpoint()}(${item.Id})`,'POST',undefined,{'IF-MATCH':'*','X-HTTP-Method':'DELETE'});",
    "const itemEtag = item => (item && item.owshiddenversion != null) ? `\"${item.owshiddenversion}\"` : '*';\nasync function deleteItem(item) {\n  if(!item)return;\n  await spCall(`${listEndpoint()}(${item.Id})`,'POST',undefined,{'IF-MATCH':itemEtag(item),'X-HTTP-Method':'DELETE'});")
# 4. merge only if nobody saved since we loaded
rep("      await spCall(`${listEndpoint()}(${prior.Id})`,'POST',fields,{'IF-MATCH':'*','X-HTTP-Method':'MERGE'});\n      CLOUD_ITEMS[title]=Object.assign({},prior,fields);",
    "      await spCall(`${listEndpoint()}(${prior.Id})`,'POST',fields,{'IF-MATCH':itemEtag(prior),'X-HTTP-Method':'MERGE'});\n      CLOUD_ITEMS[title]=Object.assign({},prior,fields,{owshiddenversion:prior.owshiddenversion!=null?Number(prior.owshiddenversion)+1:undefined});")
rep("      CLOUD_ITEMS[title]=Object.assign({Id:made&&(made.Id||made.ID)},fields);",
    "      CLOUD_ITEMS[title]=Object.assign({Id:made&&(made.Id||made.ID),owshiddenversion:(made&&made.owshiddenversion!=null)?made.owshiddenversion:1},fields);")
# 5. replacing all data from a JSON file deletes every day not in the file: ask first
rep("      else { S = st; loadStateFrom(); save(true);",
    "      else { const lost = Object.keys(S.days||{}).filter(k => !(st.days||{})[k]).length; if (lost && !confirm(`ייבוא במצב החלפה ימחק מ-SharePoint ${lost} ימים שלא קיימים בקובץ. להמשיך?\\nלביטול ובחירה במיזוג לחץ Cancel.`)) { toast('הייבוא בוטל', 'err'); return; } S = st; loadStateFrom(); save(true);")
# 6. a report whose time could not be read is flagged, not treated as fresh
rep("  const staleFiles = files.filter(f => isStale(f, key));",
    "  files.filter(f => !f.reportTime || isNaN(new Date(f.reportTime))).forEach(file => items.push({ f: F(sys.id, 'low', 'זמן הדוח לא זוהה', 'לא ניתן לאמת שהדוח עדכני. יש לבדוק את תאריך הדוח ידנית.', { rule: 'זמן דוח חסר', key: 'notime:' + file.id }), file, synthetic: true }));\n  const staleFiles = files.filter(f => isStale(f, key));")
new_name='morning-checks-web-part_'+hashlib.sha1(s.encode()).hexdigest()[:20]+'.js'
old_name=os.path.basename(js)
open(os.path.join(os.path.dirname(js),new_name),'w',encoding='utf-8').write(s); os.remove(js)
# rename references + bump versions
for p in glob.glob(root+'/**/*',recursive=True):
    if os.path.isfile(p) and (p.endswith('.xml') or p.endswith('.rels')):
        t=open(p,encoding='utf-8').read(); o=t
        t=t.replace(old_name,new_name).replace('Version="1.0.2.0"','Version="1.0.3.0"')
        if t!=o: open(p,'w',encoding='utf-8').write(t); print('updated',os.path.relpath(p,root))
print(old_name,'->',new_name)
