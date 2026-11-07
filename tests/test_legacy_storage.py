"""Run with python3 tests/test_legacy_storage.py (requires existing gjs; no packages).
Uses isolated JavaScript processes and mock storage, never browser/user data.
"""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'script.js').read_text()
LEGACY = dict(id='old-uuid', date='2026-08-01', text='旧メモ\n日本語, "引用"',
              createdAt='2026-08-01T01:02:03.456Z')
CURRENT = dict(LEGACY, id='current', updatedAt=None)
PREFIX = r'''
let writes = 0, failWrite = false;
const cards = [];
function element() {
  return { value: '', textContent: '', hidden: false, dataset: {}, handlers: {},
    classList: {toggle(){},remove(){}}, focus(){}, scrollIntoView(){},
    addEventListener(t,f){this.handlers[t]=f}, appendChild(f){cards.push(f)},
    set innerHTML(v){cards.length=0} };
}
const elements = {};
const document = {querySelector(s){return elements[s] ||= element()}};
elements['#record-template'] = {content:{cloneNode(){const nodes={};
  return {querySelector(s){return nodes[s] ||= element()}}}}};
const localStorage = {
  getItem(){if(failRead)throw Error('SecurityError');return stored},
  setItem(k,v){writes++;if(failWrite)throw Error('QuotaExceededError');stored=v}
};
const window = {confirm(){return true},clearTimeout(){},setTimeout(){}};
const setTimeout = () => {};
const navigator = {clipboard:{writeText(){return Promise.resolve()}}};
const console = {error(){}};
'''
COMMON = r'''
function assert(v,m){if(!v)throw Error(m)}
function eq(a,b,m){assert(JSON.stringify(a)===JSON.stringify(b),m)}
const originalStored = stored;
const backup = rs => JSON.stringify({app:'Madalio',formatVersion:1,records:rs});
async function importText(content){await importRecords({target:{files:[{
  name:'backup.json',text:async()=>content}],value:'selected'}})}
'''
CASES = []

def add(name, body, data=None, raw=None, fail_read=False):
    value = raw if raw is not None else json.dumps(data if data is not None else [LEGACY], ensure_ascii=False)
    CASES.append((name, body, value, fail_read))

add('legacy startup, no writes, complete field preservation', '''
assert(!storageLoadFailed,'blocked');
eq(records,[{...JSON.parse(originalStored)[0],updatedAt:null}],'fields');
assert(writes===0&&stored===originalStored,'startup wrote');
assert(cards.length===1,'display');
''')
add('current null and valid timestamp mixed with legacy', '''
assert(!storageLoadFailed&&records.length===3,'mixed');
assert(records[0].updatedAt===null&&records[1].updatedAt===null,'null');
assert(records[2].updatedAt==='2026-08-02T00:00:00+09:00','timestamp changed');
assert(writes===0&&stored===originalStored,'write');
''', [LEGACY, CURRENT, dict(CURRENT, id='edited', updatedAt='2026-08-02T00:00:00+09:00')])
add('legacy edit and save', '''
const before={...records[0]};startEdit(before.id);textInput.value='編集本文';saveRecord();
assert(records[0].text==='編集本文'&&isValidBackupTimestamp(records[0].updatedAt),'edit');
for(const key of ['id','date','createdAt'])assert(records[0][key]===before[key],key);
eq(JSON.parse(stored),records,'persist');assert(writes===1,'save count');
''')
add('normalization persists only after explicit save', '''
assert(stored===originalStored&&writes===0,'startup');textInput.value='新規';saveRecord();
assert(JSON.parse(stored).find(r=>r.id==='old-uuid').updatedAt===null,'persist null');
''')
add('legacy export and strict import', '''
let output;downloadFile=(name,content)=>output=content;exportAsJson();
eq(JSON.parse(output),{app:'Madalio',formatVersion:1,records},'export');
assert(JSON.parse(output).records[0].updatedAt===null,'export null');
let rejected=false;try{parseJsonBackup(backup(JSON.parse(originalStored)))}catch(e){rejected=true}
assert(rejected,'legacy JSON accepted');await importText(backup(JSON.parse(originalStored)));
assert(writes===0&&stored===originalStored,'invalid import wrote');
''')
add('timestamp comparison and equal local priority', '''
const old={...records[0]};
let result=mergeBackupRecords(records,[{...old,text:'同時刻'}]);
assert(result.updated===0&&result.records[0]===records[0],'local identity');
assert(result.records[0].text===old.text,'tie changed');
result=mergeBackupRecords(records,[{...old,text:'new',updatedAt:'2026-08-01T11:02:03.456+09:00'}]);
assert(result.updated===1,'new timestamp not adopted');
const newer=result.records;
result=mergeBackupRecords(newer,[{...old,text:'older',updatedAt:'2026-08-01T01:02:03.456Z'}]);
assert(result.updated===0&&result.records[0].text==='new','older replaced');
''')
for operation, action in [
 ('create', "textInput.value='未保存';saveRecord()"),
 ('edit', "startEdit(records[0].id);textInput.value='未保存';saveRecord()"),
 ('delete', "startEdit(records[0].id);textInput.value='未保存';cards[0].querySelector('.delete-button').handlers.click()"),
 ('import', "startEdit(records[0].id);textInput.value='未保存';await importText(backup([{...records[0],id:'new'}]))")]:
    add(operation+' failure retains normalized records and original storage', '''
const before=JSON.stringify(records);failWrite=true;
'''+action+''';
assert(JSON.stringify(records)===before&&stored===originalStored,'changed');
assert(textInput.value==='未保存','draft lost');assert(cards.length===1,'view');
assert(statusMessage.textContent.includes('保存に失敗'),'error');
''')
blocked = '''
assert(storageLoadFailed&&records===null,'not blocked');
assert(saveButton.disabled&&importButton.disabled&&exportJsonButton.disabled,'UI');
saveRecord();saveRecords([]);exportAsJson();await importText(backup([]));
assert(writes===0&&stored===originalStored,'original overwritten');
'''
for value in ['', 1, False, 'bad', '2026-02-30T00:00:00Z', [], {}]:
    add('reject explicit updatedAt '+repr(value), blocked, [dict(LEGACY, updatedAt=value)])
for key in ['id', 'date', 'text', 'createdAt']:
    add('reject missing '+key, blocked, [{k:v for k,v in LEGACY.items() if k!=key}])
for key,value in [('id',42),('date','2026-02-30'),('createdAt','bad'),('text',None)]:
    add('reject invalid '+key, blocked, [dict(LEGACY, **{key:value})])
for value in [None, 1, [], 'bad']:
    add('reject malformed array element '+repr(value), blocked, [value])
add('reject duplicate IDs', blocked, [LEGACY, LEGACY])
add('reject non-array root', blocked, {'records':[LEGACY]})
add('reject malformed JSON', blocked, raw='{broken')
add('read exception', blocked, fail_read=True)

# Date-only ordering remains primary; timestamps are compared as instants.
add('sort mixed Z and positive offset by actual instant', """
const base=records[0];
records=[{...base,id:'older',createdAt:'2026-08-01T10:00:00+09:00'},
         {...base,id:'newer',createdAt:'2026-08-01T02:00:00Z'}];
const before=JSON.stringify(records);
eq(getSortedRecords().map(r=>r.id),['newer','older'],'timezone sort');
assert(JSON.stringify(records)===before&&stored===originalStored&&writes===0,'sort mutated data');
""")
add('sort negative offset and fractional seconds', """
const base=records[0];
records=[{...base,id:'older',createdAt:'2026-08-01T09:00:00.100+09:00'},
         {...base,id:'newer',createdAt:'2026-07-31T20:00:00.200-04:00'}];
eq(getSortedRecords().map(r=>r.id),['newer','older'],'offset/fraction sort');
""")
add('equivalent timestamps preserve input order', """
const base=records[0];
records=[{...base,id:'first',createdAt:'2026-08-01T09:00:00.000+09:00'},
         {...base,id:'second',createdAt:'2026-08-01T00:00:00Z'}];
eq(getSortedRecords().map(r=>r.id),['first','second'],'equal instant order');
records.reverse();
eq(getSortedRecords().map(r=>r.id),['second','first'],'reversed equal instant order');
""")
add('date remains primary and updatedAt does not change display order', """
const base=records[0];
records=[{...base,id:'earlier-day',date:'2026-08-01',createdAt:'2026-08-02T10:00:00Z',updatedAt:'2026-08-03T00:00:00Z'},
         {...base,id:'later-day',date:'2026-08-02',createdAt:'2026-08-01T00:00:00Z'}];
eq(getSortedRecords().map(r=>r.id),['later-day','earlier-day'],'date precedence');
""")
add('merge equal offset instants keeps local and newer Z wins', """
const local={...records[0],updatedAt:'2026-08-01T10:00:00+09:00'};
const tied={...local,text:'JSON',updatedAt:'2026-08-01T01:00:00Z'};
const result=mergeBackupRecords([local],[tied]);
assert(result.updated===0&&result.records[0]===local,'tie replaced local');
const newer={...tied,updatedAt:'2026-08-01T02:00:00Z'};
assert(mergeBackupRecords([local],[newer]).records[0]===newer,'newer Z ignored');
""")
add('merge createdAt fallback uses actual instant', """
const local={...records[0],createdAt:'2026-08-01T10:00:00+09:00',updatedAt:null};
const newer={...local,text:'JSON',createdAt:'2026-08-01T02:00:00Z'};
assert(mergeBackupRecords([local],[newer]).records[0]===newer,'createdAt fallback');
""")

with tempfile.TemporaryDirectory(prefix='madalio-legacy-tests-') as directory:
    for name,body,stored,fail_read in CASES:
        setup = '\nlet stored='+json.dumps(stored)+';let failRead='+str(fail_read).lower()+';\n'
        test = Path(directory)/'case.js'
        test.write_text(PREFIX+setup+SOURCE+COMMON+'\n(async()=>{'+body+'''\n})().catch(e=>{
printerr(e.stack);imports.system.exit(1)});''')
        result=subprocess.run(['gjs',str(test)],capture_output=True,text=True)
        if result.returncode:
            raise SystemExit('FAIL '+name+'\n'+result.stderr)
        print('PASS '+name)
print(f'All {len(CASES)} legacy regression cases passed')
