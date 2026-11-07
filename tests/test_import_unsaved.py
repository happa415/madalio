"""python3 tests/test_import_unsaved.py — isolated GJS tests, no user data."""
import json
from pathlib import Path
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'script.js').read_text()
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
const dialogs = []; let approval = true, onConfirm = () => {};
const window = {confirm(message){dialogs.push(message);onConfirm();return approval},clearTimeout(){},setTimeout(){}};
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
RECORD = dict(id='a',date='2026-08-01',text='保存済み',createdAt='2026-08-01T01:02:03.456Z',updatedAt=None)
NORMAL = 'JSONバックアップを読み込みますか？\nバックアップのメモを追加・更新します。'
WARNING = 'JSONバックアップを読み込みますか？\nバックアップのメモを追加・更新します。\n保存していない入力途中の文章は消去されます。'
SETUP = '''
const normalMessage = %s;
const warningMessage = %s;
const added = {...records[0],id:'new'};
function unchanged(text,id){
  assert(stored===originalStored&&writes===0,'storage');
  assert(records.length===1&&records[0].text==='保存済み','records');
  assert(textInput.value===text&&editingRecordId===id,'input/edit state');
}
''' % (json.dumps(NORMAL),json.dumps(WARNING))
CASES=[]
def add(name,body):CASES.append((name,body))
for label,prepare in [
 ('new draft',"textInput.value='未保存'"),
 ('new whitespace',"textInput.value=' \\n '"),
 ('changed edit',"startEdit('a');textInput.value='変更'"),
 ('empty edit',"startEdit('a');textInput.value=''"),
 ('edit whitespace',"startEdit('a');textInput.value=records[0].text+' '"),
 ('edit newline',"startEdit('a');textInput.value=records[0].text+'\\n'")]:
 add(label+' warns once on success',prepare+''';await importText(backup([added]));
assert(dialogs.length===1&&dialogs[0]===warningMessage,'warning');
assert(writes===1&&records.length===2,'saved');
assert(textInput.value===''&&editingRecordId===null,'finish');''')
for label,prepare in [('empty input',''),('unchanged edit',"startEdit('a');")]:
 add(label+' normal message',prepare+'''await importText(backup([added]));
assert(dialogs.length===1&&dialogs[0]===normalMessage,'normal confirmation');
assert(writes===1&&textInput.value===''&&editingRecordId===null,'finish');''')
for label,prepare,id_value in [('new',"textInput.value='draft';",'null'),('edit',"startEdit('a');textInput.value='draft';","'a'")]:
 add(label+' cancel',prepare+'''approval=false;await importText(backup([added]));
unchanged('draft',%s);assert(dialogs.length===1,'dialog count');'''%id_value)
 add(label+' save failure',prepare+'''failWrite=true;await importText(backup([added]));
assert(stored===originalStored&&records.length===1&&textInput.value==='draft','preserve');
assert(editingRecordId===%s&&writes===1,'edit/write');'''%id_value)
 for name,content in [('invalid JSON',"'{broken'"),('invalid schema',"backup([{...added,updatedAt:''}])"),('unchanged',"backup(records)"),('empty array',"backup([])")]:
  add(label+' '+name,prepare+'''await importText(%s);unchanged('draft',%s);
assert(dialogs.length===0,'unnecessary dialog');'''%(content,id_value))
 add(label+' file selection canceled',prepare+'''await importRecords({target:{files:[],value:''}});
unchanged('draft',%s);assert(dialogs.length===0,'dialog');'''%id_value)
add('input changes while file.text waits', '''
let complete;
const pending=importRecords({target:{files:[{name:'backup.json',text:()=>new Promise(r=>complete=r)}],value:''}});
textInput.value='後から入力';complete(backup([added]));await pending;
assert(dialogs.length===1&&dialogs[0]===warningMessage,'latest input not checked');
''')
add('input cleared while file.text waits', '''
textInput.value='before';let complete;
const pending=importRecords({target:{files:[{name:'backup.json',text:()=>new Promise(r=>complete=r)}],value:''}});
textInput.value='';complete(backup([added]));await pending;
assert(dialogs.length===1&&dialogs[0]===normalMessage,'stale input used');
''')
add('same editing ID updated', '''
startEdit('a');textInput.value='draft';
await importText(backup([{...records[0],text:'JSON側',updatedAt:'2026-08-02T00:00:00.000Z'}]));
assert(dialogs[0]===warningMessage&&dialogs.length===1,'warning');
assert(records[0].text==='JSON側'&&editingRecordId===null&&textInput.value==='','result');
''')
add('change during confirm aborts without saving', '''
textInput.value='before';onConfirm=()=>{textInput.value='after'};
await importText(backup([added]));unchanged('after',null);
assert(dialogs.length===1&&statusMessage.textContent.includes('中止'),'abort');
''')
add('editing ID changes during confirm aborts', '''
onConfirm=()=>startEdit('a');await importText(backup([added]));
unchanged('保存済み','a');assert(dialogs.length===1,'extra dialog');
''')
add('reentrant input change during setItem is retained', '''
textInput.value='before';const nativeSet=localStorage.setItem;
localStorage.setItem=(k,v)=>{nativeSet(k,v);textInput.value='after'};
await importText(backup([added]));
assert(writes===1&&records.length===2&&textInput.value==='after','new input discarded');
''')
with tempfile.TemporaryDirectory(prefix='madalio-import-tests-') as directory:
 for name,body in CASES:
  setup='\nlet failRead=false;let stored='+json.dumps(json.dumps([RECORD],ensure_ascii=False))+';\n'
  test=Path(directory)/'case.js'
  test.write_text(PREFIX+setup+SOURCE+COMMON+SETUP+'\n(async()=>{'+body+'\n})().catch(e=>{printerr(e.stack);imports.system.exit(1)});')
  result=subprocess.run(['gjs',str(test)],capture_output=True,text=True)
  if result.returncode:raise SystemExit('FAIL '+name+'\n'+result.stderr)
  print('PASS '+name)
print(f'All {len(CASES)} unsaved-input tests passed')
