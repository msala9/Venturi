import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTransitionSelection} from '../js/inspector.js';

function harness(t,{disabled=false,kind='Push',commit}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option,commands=[],notices=[];
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.disabled=false;this.value='';}
    append(...items){this.children.push(...items);}reportValidity(){return true;}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{globalThis.document=priorDocument;globalThis.Option=priorOption;});
  const target={track_id:'0',clip_id:'9007199254740993',slot:'cut_after',max:48,transition:{kind,duration:13,direction:'Up',ease:'Out',curve:0.625}};
  let current=structuredClone(target),allowed=true;
  const root=new Element('div');
  renderTransitionSelection(root,target,{disabled,getTarget:()=>current,canInteract:()=>allowed,commit:async operation=>{commands.push(operation);return commit?.(operation);},notice:message=>notices.push(message)});
  const form=root.children[1],fields=Object.fromEntries(form.children.filter(node=>node.tagName==='label').map(node=>[node.textContent,node.children[0]])),apply=form.children.at(-2),remove=form.children.at(-1);
  return {root,form,fields,apply,remove,commands,notices,stale(){current={...current,transition:{...current.transition,curve:0.25}};},readonly(){allowed=false;},submit(){form.dispatchEvent(new Event('submit',{cancelable:true}));},erase(){remove.dispatchEvent(new Event('click'));}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('selected native transition form sends one complete edit and suppresses duplicate submissions',async t=>{
  const h=harness(t);h.fields['Duration frames'].value='17';h.submit();h.submit();await settle();
  assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:'9007199254740993',slot:'cut_after',transition:{kind:'Push',duration:17,direction:'Up',ease:'Out',curve:0.625}}]);
  assert.equal(h.apply.disabled,true);assert.equal(h.remove.disabled,true);
});

test('transition form no-op has no write, removal is explicit, and non-Push direction remains preserved',async t=>{
  const h=harness(t,{kind:'SmoothCut'});assert.equal(h.fields['Push direction'],undefined);h.submit();await settle();assert.deepEqual(h.commands,[]);
  h.erase();h.erase();await settle();assert.deepEqual(h.commands,[{kind:'set_transition',clip_id:'9007199254740993',slot:'cut_after',transition:null}]);
});

test('stale and read-only transition forms refuse writes and control keys stay scoped',async t=>{
  const h=harness(t);h.fields.Curve.value='0.75';h.stale();h.submit();await settle();assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/changed/);
  h.readonly();h.erase();await settle();assert.deepEqual(h.commands,[]);
  let bubbled=false;const event=new Event('keydown');Object.defineProperty(event,'key',{value:'Delete'});event.stopPropagation=()=>{bubbled=true;};h.remove.dispatchEvent(event);assert.equal(bubbled,true);
});
