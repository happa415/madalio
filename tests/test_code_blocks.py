"""python3 tests/test_code_blocks.py — GJS, mock DOM/clipboard/storage only."""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'script.js').read_text()
PREFIX = r'''
class Node {
  constructor(tag='div') {this.tagName=tag;this.children=[];this.attributes={};this.handlers={};
    this.className='';this.dataset={};this.value='';this.disabled=false;this.hidden=false;this._text='';
    this.classList={toggle(){},remove(){}};}
  set textContent(value){this._text=String(value);this.children=[]}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
  set innerHTML(value){this._text='';this.children=[]}
  appendChild(node){if(node.tagName==='#fragment'){for(const c of [...node.children])this.appendChild(c)}
    else {node.parentNode=this;this.children.push(node)}return node}
  replaceChildren(...nodes){this._text='';this.children=[];for(const n of nodes)this.appendChild(n)}
  setAttribute(k,v){this.attributes[k]=String(v)}
  getAttribute(k){return this.attributes[k]??null}
  addEventListener(k,f){this.handlers[k]=f}
  focus(){} scrollIntoView(){}
  querySelector(selector){return findAll(this,selector)[0]||null}
}
function findAll(node,selector){const out=[];for(const c of node.children){
  if(selector.startsWith('.')?c.className.split(' ').includes(selector.slice(1)):c.tagName===selector)out.push(c);
  out.push(...findAll(c,selector));}return out}
const elements={};
const document={querySelector(s){return elements[s] ||= new Node()},createElement(t){return new Node(t)},
  createElementNS(ns,t){return new Node(t)},createDocumentFragment(){return new Node('#fragment')}};
function recordFragment(){const fragment=new Node('#fragment');const card=new Node('article');card.className='record-card';
 for(const [tag,cls] of [['time','record-date'],['div','record-text'],['button','copy-button'],['button','edit-button'],['button','delete-button']]){
  const n=new Node(tag);n.className=cls;card.appendChild(n)}fragment.appendChild(card);return fragment}
elements['#record-template']={content:{cloneNode:recordFragment}};
let stored=null,writes=0,copied=[],timerId=0;const timers=new Map();
const localStorage={getItem(){return stored},setItem(k,v){writes++;stored=v}};
function setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id}
const window={confirm(){return true},setTimeout,clearTimeout(id){timers.delete(id)}};
const navigator={clipboard:{writeText(text){copied.push(text);return Promise.resolve()}}};
const console={error(){}};
function assert(v,m){if(!v)throw Error(m)}
function eq(a,b,m){assert(JSON.stringify(a)===JSON.stringify(b),m)}
function codeParts(text){return parseCodeBlocks(text).filter(p=>p.type==='code')}
function render(text){const root=new Node();renderRecordText(root,text);return root}
function buttons(root){return findAll(root,'.code-copy-button')}
function isCheck(button){return findAll(button,'path')[0].getAttribute('d')==='M5 12l4 4L19 6'}
function flushTimers(){const list=[...timers.values()];timers.clear();for(const t of list)t.fn()}
'''
CASES = []
def add(name, body): CASES.append((name, body))

add('plain text unchanged, unsupported Markdown literal', r'''
const text='# 見出し\n**bold** `inline`\n~~~bash\nx\n~~~';
eq(parseCodeBlocks(text),[{type:'text',text}],'plain parse');const root=render(text);
assert(root.textContent===text&&root.children.length===0,'plain display');
''')
add('single block, optional language and original trailing newline', r'''
const parts=parseCodeBlocks('前文\n\n```bash\na\nb\n```\n後文');
eq(parts,[{type:'text',text:'前文\n\n'},{type:'code',language:'bash',text:'a\nb\n'},{type:'text',text:'後文'}],'parts');
eq(codeParts('```\na\n```')[0],{type:'code',language:'',text:'a\n'},'no language');
''')
add('multiple blocks with independent copy data', r'''
const root=render('```a\nfirst\n```\nbetween\n```b\nsecond\n```');
const bs=buttons(root);await bs[0].handlers.click();await bs[2].handlers.click();
eq(copied,['first\n','second\n'],'independent copy');
assert(findAll(root,'.code-block').length===2,'block count');
''')
add('longer fence, shorter fence is content, suffix text not closing', r'''
const text='````go\n```\n```suffix\n````` \t\nafter';
eq(codeParts(text),[{type:'code',language:'go',text:'```\n```suffix\n'}],'fences');
''')
add('indented opening is literal and indented closing is content', r'''
for(const indent of [' ','\t']){
 const input=indent+'```bash\nx';assert(codeParts(input).length===0,'indented opening');
 const block='```\nx\n'+indent+'```\nend\n```';
 assert(codeParts(block)[0].text==='x\n'+indent+'```\nend\n','indented closing');}
''')
add('unclosed fence preserves rest after earlier complete block', r'''
const input='```\na\n```\n前文\n```bash\nunfinished\n``';
const parts=parseCodeBlocks(input);assert(parts.length===2,'parts');
assert(parts[1].text==='前文\n```bash\nunfinished\n``','unclosed rest');
const root=render('前文\n```bash\nx');assert(root.textContent==='前文\n```bash\nx','unclosed render');
''')
add('CRLF blank lines tabs Unicode and whitespace preserved', r'''
const raw='  日本語 😀 <>&"\t\r\n\r\n\t \r\nend  \r\n';
const root=render('```text\r\n'+raw+'```\r\n');const bs=buttons(root);
assert(bs.length===3,'blank row buttons');await bs[0].handlers.click();await bs[1].handlers.click();await bs[2].handlers.click();
eq(copied,[raw,'  日本語 😀 <>&"\t','end  '],'exact strings');
assert(findAll(root,'.code-line').length===4,'extra trailing row');
''')
add('line tokenization with and without final newline', r'''
eq(splitTextLines('a\nb').map(l=>l.text),['a','b'],'no newline');
eq(splitTextLines('a\nb\n').map(l=>l.text),['a','b'],'trailing newline');
eq(splitTextLines('a\n\n').map(l=>l.text),['a',''],'intentional blank');
assert(splitTextLines('').length===0,'empty');
''')
add('empty and whitespace-only blocks visible but copy disabled', r'''
for(const raw of ['', '\n', ' \t\r\n']){
 const root=render('```\n'+raw+'```');const bs=buttons(root);
 assert(findAll(root,'.code-block').length===1&&bs.length===1&&bs[0].disabled,'empty disabled');
 await bs[0].handlers.click();assert(copied.length===0,'empty copied');}
''')
add('HTML and language are literal, controls outside pre/code', r'''
const raw='<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n';
const root=render('```<img onerror=x>\n'+raw+'```');
assert(findAll(root,'script').length===0&&findAll(root,'img').length===0,'HTML interpreted');
assert(findAll(root,'.code-language')[0].textContent==='<img onerror=x>','language');
const pre=findAll(root,'pre')[0];assert(findAll(pre,'code').length===1&&findAll(pre,'button').length===0,'pre structure');
assert(pre.tabIndex===0,'scroll keyboard');
for(const b of buttons(root)){
 assert(b.type==='button'&&b.getAttribute('aria-label').includes('コピー'),'button accessibility');
 assert(findAll(b,'svg')[0].getAttribute('aria-hidden')==='true','icon aria');}
''')
add('success check lasts 800ms and repeated pending clicks do not duplicate', r'''
const b=buttons(render('```\na\n```'))[0];let done;
navigator.clipboard.writeText=t=>{copied.push(t);return new Promise(resolve=>done=resolve)};
const pending=b.handlers.click();await b.handlers.click();assert(copied.length===1&&!isCheck(b),'pending');
done();await pending;assert(isCheck(b)&&b.disabled,'success');
assert([...timers.values()].some(t=>t.ms===800),'duration');flushTimers();
assert(!isCheck(b)&&!b.disabled,'reset');
navigator.clipboard.writeText=t=>{copied.push(t);return Promise.resolve()};
await b.handlers.click();assert(copied.length===2,'repeat');flushTimers();
''')
for label,setup in [('rejected',"navigator.clipboard.writeText=()=>Promise.reject(Error('denied'))"),
                    ('missing API',"delete navigator.clipboard"),
                    ('missing writeText',"navigator.clipboard={}"),
                    ('synchronous throw',"navigator.clipboard.writeText=()=>{throw Error('blocked')}")]:
 add('copy failure '+label,setup+r''';
 const b=buttons(render('```\na\n```'))[0];await b.handlers.click();
 assert(!isCheck(b)&&!b.disabled&&statusMessage.textContent==='コピーに失敗しました。','failure handling');
 ''')
add('redraw while pending copy and feedback does not throw', r'''
const root=render('```\na\n```');const b=buttons(root)[0];let done;
navigator.clipboard.writeText=()=>new Promise(r=>done=r);const pending=b.handlers.click();
renderRecordText(root,'new plain');done();await pending;flushTimers();
assert(root.textContent==='new plain','stale render changed');
''')
add('many long lines keep source and line count', r'''
const raw=Array.from({length:1500},(_,i)=>'  '+i+' '+('x'.repeat(200))).join('\n')+'\n';
const text='```bash\n'+raw+'```';const root=render(text);
assert(codeParts(text)[0].text===raw&&findAll(root,'.code-line').length===1500,'large input');
assert(buttons(root).length===1501,'large buttons');
''')
add('existing edit save full-copy JSON and delete preserve source', r'''
const text='```bash\n echo "日本語"\n```';
records=[{id:'a',date:'2026-08-01',text,createdAt:null,updatedAt:null}];renderRecords();
const card=recordsList.children[0];assert(findAll(card,'.code-block').length===1,'render hook');
copyRecordText(records[0],card.querySelector('.copy-button'));await Promise.resolve();
assert(copied[0]===text,'whole memo changed');
startEdit('a');assert(textInput.value===text,'edit text');textInput.value=text+'\nあと';saveRecord();
assert(records[0].text===text+'\nあと'&&records[0].id==='a','save');
let output;downloadFile=(name,content)=>output=content;exportAsJson();
const restored=parseJsonBackup(output);assert(restored[0].text===records[0].text,'JSON text');
recordsList.children[0].querySelector('.delete-button').handlers.click();assert(records.length===0,'delete');
''')

with tempfile.TemporaryDirectory(prefix='madalio-code-tests-') as directory:
 for name,body in CASES:
  # Raw Python strings make JS escape sequences explicit in readable test bodies.
  path=Path(directory)/'case.js'
  path.write_text(PREFIX+SOURCE+'\n(async()=>{'+body+'\n})().catch(e=>{printerr(e.stack);imports.system.exit(1)});')
  result=subprocess.run(['gjs',str(path)],capture_output=True,text=True)
  if result.returncode:raise SystemExit('FAIL '+name+'\n'+result.stderr)
  print('PASS '+name)
print(f'All {len(CASES)} code block cases passed')
