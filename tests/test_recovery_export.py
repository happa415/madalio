"""python3 tests/test_recovery_export.py — GJS with isolated mock storage and downloads."""
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
const window = {confirm(){return true},clearTimeout(){},setTimeout(){}};
const setTimeout = () => {};
const navigator = {clipboard:{writeText(){return Promise.resolve()}}};
const console = {error(){}};
'''
DOWNLOADS = r'''
let artifact=null, downloaded=false, failAt='';
class Blob {
  constructor(parts,options){if(failAt==='blob')throw Error('blob');artifact={parts,options}}
}
const URL={createObjectURL(){if(failAt==='url')throw Error('url');return 'blob:test'},revokeObjectURL(){}};
document.body={appendChild(){if(failAt==='append')throw Error('append')}};
document.createElement=()=>({click(){if(failAt==='click')throw Error('click');downloaded=true},remove(){}});
const RealDate=Date;
Date=class extends RealDate {constructor(...args){super(...(args.length?args:[2026,6,1,9,8,7]))}};
function assert(v,m){if(!v)throw Error(m)}
const originalStored=stored;
const protectedMessage=statusMessage.textContent;
function protectedState(){
 assert(storageLoadFailed&&records===null,'protection');
 assert(exportJsonButton.disabled&&saveButton.disabled&&importButton.disabled,'controls');
 assert(stored===originalStored&&writes===0,'storage changed');
 assert(statusMessage.textContent===protectedMessage,'main error overwritten');
}
'''
VALID=[dict(id='valid',date='2026-07-01',text='通常',createdAt=None,updatedAt=None)]
CASES=[]
def add(name,body,raw='{broken',read_error=False):CASES.append((name,body,raw,read_error))
add('normal state hides recovery and blocks direct recovery call',"""
assert(!storageLoadFailed&&recoveryActions.hidden,'normal visibility');
exportRecoveryData();assert(!downloaded&&writes===0,'normal export allowed');
""",json.dumps(VALID))
for label,raw in [('invalid JSON','{broken'),('invalid structure',' { "records": [1] } '),
 ('special characters',' \ufeff日本語\r\n, "引用" 😀\t\u0000 '),('empty stored string','')]:
 add(label+' raw export exact content',"""
assert(!recoveryActions.hidden,'recovery hidden');
recoveryButton.handlers.click();
assert(downloaded&&artifact.parts.length===1,'no download');
const actual=artifact.parts[0];assert(actual===originalStored,'raw mismatch');
assert(actual.length===originalStored.length,'length');
for(let i=0;i<actual.length;i++)assert(actual.charCodeAt(i)===originalStored.charCodeAt(i),'code unit');
assert(recoveryMessage.textContent.includes('保存を開始'),'notification');
protectedState();exportAsJson();assert(writes===0,'normal export wrote');
""",raw)
add('filename uses local date and time',"""
let filename;const create=document.createElement;
document.createElement=()=>{const link=create();Object.defineProperty(link,'download',{set(v){filename=v}});return link};
exportRecoveryData();assert(filename==='madalio-recovery-20260701-090807.json','local filename');protectedState();
""")
add('read access exception',"""
exportRecoveryData();assert(!downloaded&&artifact===null,'download after exception');
assert(recoveryMessage.textContent.includes('読み取れません'),'read error');protectedState();
""",read_error=True)
add('read exception can be retried without unlocking',"""
failRead=true;exportRecoveryData();assert(!downloaded,'unexpected download');
failRead=false;exportRecoveryData();assert(downloaded,'retry failed');protectedState();
""")
add('missing value does not create a file',"""
stored=null;exportRecoveryData();assert(!downloaded&&artifact===null,'missing downloaded');
assert(recoveryMessage.textContent.includes('存在しない'),'missing error');
assert(storageLoadFailed&&writes===0&&stored===null,'missing protection');
""")
for stage in ['blob','url','append','click']:
 add('download failure '+stage,"""
failAt=%s;exportRecoveryData();assert(!downloaded,'failed download succeeded');
assert(recoveryMessage.textContent.includes('ファイル生成・ダウンロード開始に失敗'),'download error');
protectedState();
"""%json.dumps(stage))
add('click rereads storage rather than using startup snapshot',"""
stored='new raw value';exportRecoveryData();assert(artifact.parts[0]===stored,'stale export');
assert(writes===0&&storageLoadFailed,'write or unlock');
""")
with tempfile.TemporaryDirectory(prefix='madalio-recovery-tests-') as directory:
 for name,body,raw,read_error in CASES:
  setup='let stored='+json.dumps(raw)+';let failRead='+str(read_error).lower()+';\n'
  path=Path(directory)/'case.js';path.write_text(PREFIX+setup+SOURCE+DOWNLOADS+'\n'+body)
  result=subprocess.run(['gjs',str(path)],capture_output=True,text=True)
  if result.returncode:raise SystemExit('FAIL '+name+'\n'+result.stderr)
  print('PASS '+name)
print(f'All {len(CASES)} recovery export cases passed')
