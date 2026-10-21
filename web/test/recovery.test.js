import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryName,recoveryOperation,createRecoveryPanel} from '../js/recovery.js';
const pending={state:'pending',pending:true,project_token:'Original.vvproj',revision:'a'.repeat(64),created_unix_ms:1792540000000,base_changed:false};
test('recovery uses an exact receipt and a bounded new project name',()=>{
  assert.equal(recoveryName('Original.vvproj'),'Original_recovered');assert.equal(recoveryName('x'.repeat(128)).length,64);assert.match(recoveryName('A/B media.vvproj'),/^[A-Za-z0-9_-]+$/);
  assert.deepEqual(recoveryOperation(pending,{name:'Recovered',open:false}),{kind:'recover_autosave',revision:'a'.repeat(64),name:'Recovered',open:false});
  for(const values of [{name:'../outside',open:true},{name:'copy',open:'true'}])assert.throws(()=>recoveryOperation(pending,values));assert.throws(()=>recoveryOperation({...pending,pending:false},{name:'copy',open:true}));
});
class Control extends EventTarget {constructor(){super();this.disabled=false;this.hidden=false;this.value='';this.checked=true;this.textContent='';}reportValidity(){return true;}}
function harness(api=async()=>pending,commit=async()=>{}){
  const nodes=new Map(),root=new Control();root.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,new Control());return nodes.get(selector);};const status=new Control(),button=new Control(),commits=[];let writable=true,opened=0,projects=0;
  const panel=createRecoveryPanel({root,status,button,canCommit:()=>writable,commit:async operation=>{commits.push(operation);await commit(operation,panel);},openProjects:()=>{projects++;},onOpened:()=>{opened++;},notice(){},api});panel.update(pending);
  return {panel,root,status,button,nodes,commits,name:nodes.get('[name="recovery_name"]'),open:nodes.get('[name="open_recovery"]'),apply:nodes.get('[data-recovery-apply]'),submit:()=>nodes.get('form').dispatchEvent(new Event('submit',{cancelable:true})),setWritable:value=>{writable=value;},counts:()=>({opened,projects})};
}
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}
test('late status responses cannot resurrect a recovered snapshot',async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}),async(_,panel)=>panel.update({...pending,state:'saved',pending:false,revision:'b'.repeat(64)}));const loading=h.panel.refresh();h.submit();await settle();resolve(pending);await loading;assert.equal(h.root.hidden,true);assert.equal(h.apply.disabled,true);assert.equal(h.commits.length,1);assert.equal(h.counts().opened,1);
});
test('a refused recovery retains its name and open choice until an explicit retry',async()=>{
  let attempts=0;const h=harness(async()=>pending,async()=>{if(++attempts===1)throw Error('Save current edits first');});h.name.value='Keep_this_copy';h.submit();await settle();assert.equal(h.name.value,'Keep_this_copy');assert.equal(h.open.checked,true);assert.match(h.nodes.get('[data-recovery-detail]').textContent,/Save current edits first.*choices retained/);
  h.open.checked=false;h.submit();await settle();assert.equal(h.commits[1].open,false);assert.equal(h.commits[1].name,'Keep_this_copy');assert.equal(h.counts().opened,0);assert.equal(h.counts().projects,1);
});
test('read-only or unsupported snapshots cannot be submitted',async()=>{
  const h=harness();h.setWritable(false);h.panel.invalidate();h.submit();await settle();assert.equal(h.commits.length,0);h.setWritable(true);h.panel.update({state:'blocked',pending:true,error:'Preserved unsupported snapshot'});assert.equal(h.apply.disabled,true);h.submit();await settle();assert.equal(h.commits.length,0);assert.match(h.status.textContent,/Recovery unavailable/);
});
