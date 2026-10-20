import test from 'node:test';
import assert from 'node:assert/strict';
import {attributesIdentity,attributesOperation,createPasteAttributes} from '../js/attributes.js';

test('property paste identity binds the native clipboard, selection and document',()=>{
  const context={epoch:'epoch',generation:'2',timeline:'1',revision:'revision',clipboard:'captured',clip_ids:['3','2']};
  assert.equal(attributesIdentity(context),attributesIdentity({...context,clip_ids:['2','3']}));
  for(const field of ['epoch','generation','timeline','revision','clipboard'])assert.notEqual(attributesIdentity(context),attributesIdentity({...context,[field]:'changed'}));
  assert.notEqual(attributesIdentity(context),attributesIdentity({...context,clip_ids:['4']}));
  assert.deepEqual(attributesOperation(context,['opacity'],'stretch_to_fit'),{kind:'paste_attributes',clip_ids:['3','2'],clipboard_revision:'captured',attributes:['opacity'],keyframes:'stretch_to_fit'});
});
class Control extends EventTarget {
  constructor(){super();this.children=[];this.disabled=false;this.checked=false;this.value='';}
  append(...children){this.children.push(...children);}
}
function harness(commit=async()=>{}){
  globalThis.document={createElement:()=>new Control(),createTextNode:text=>({textContent:text})};
  const nodes=new Map(),root=new Control();root.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,new Control());return nodes.get(selector);};root.showModal=()=>{root.open=true;};root.close=()=>{root.open=false;};
  const context={epoch:'epoch',generation:'2',timeline:'1',revision:'rev',clipboard:'captured',clip_ids:['2']},commits=[];let writable=true;
  const controller=createPasteAttributes({root,getContext:()=>context,canCommit:()=>writable,commit:async op=>{commits.push(op);await commit(op);},notice(){}});
  nodes.get('[name="keyframes"]').value='maintain_timing';
  return {root,context,controller,commits,nodes,check(){nodes.get('[data-attribute-groups]').children[9].children[0].checked=true;nodes.get('form').dispatchEvent(new Event('change'));},submit(){nodes.get('form').dispatchEvent(new Event('submit',{cancelable:true}));},setWritable:value=>{writable=value;}};
}
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}
test('property paste requires explicit selection and refuses stale or read-only confirmation',async()=>{
  const h=harness();h.controller.open();assert.equal(h.nodes.get('[data-attribute-apply]').disabled,true);h.check();assert.equal(h.nodes.get('[data-attribute-apply]').disabled,false);h.setWritable(false);h.controller.invalidate();h.submit();await settle();assert.equal(h.commits.length,0);h.setWritable(true);h.context.clipboard='new copy';h.controller.invalidate();h.submit();await settle();assert.equal(h.commits.length,0);assert.equal(h.nodes.get('[data-attribute-apply]').disabled,true);
});
test('property paste retains choices on native refusal and prevents duplicate submissions',async()=>{
  let fail;const h=harness(()=>new Promise((_,reject)=>{fail=reject;}));h.controller.open();h.check();h.submit();h.submit();await settle();assert.equal(h.commits.length,1);assert.equal(h.nodes.get('[data-attribute-close]').disabled,true);fail(Error('Target locked'));await settle();assert.equal(h.root.open,true);assert.equal(h.nodes.get('[data-attribute-apply]').disabled,false);assert.match(h.nodes.get('[data-attribute-status]').textContent,/choices retained/);assert.deepEqual(h.commits[0].attributes,['opacity']);
});
