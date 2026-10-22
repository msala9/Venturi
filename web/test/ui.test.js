import test from "node:test";
import assert from "node:assert/strict";
import { isTextTarget, installClipListDismissal } from "../js/ui.js";

function clipListHarness(){
  const listeners=new Map();let focused=null;
  const summary={closest:()=>null,focus(){focused=summary;}},clip={closest:()=>null},outside={closest:()=>null},input={closest:()=>({})};
  const menu={open:true,contains:target=>target===summary || target===clip,querySelector:()=>summary};
  const documentRef={addEventListener(name,callback,capture){assert.equal(capture,true);if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(callback);},removeEventListener(name,callback){listeners.get(name)?.delete(callback);}};
  const dismissal=installClipListDismissal(menu,{documentRef});
  const emit=(name,target,extra={})=>{
    const event={target,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
    for(const callback of listeners.get(name) || [])callback(event);return event;
  };
  return {menu,summary,clip,outside,input,dismissal,emit,focused:()=>focused};
}

test('Clip list closes before outside Export activation without intercepting the button or modified clip selection',()=>{
  const h=clipListHarness();
  const inside=h.emit('pointerdown',h.clip,{shiftKey:true,ctrlKey:true});
  assert.equal(h.menu.open,true);assert.equal(inside.defaultPrevented,false);assert.equal(inside.stopped,false);
  const selected=[];if(!inside.defaultPrevented)selected.push('clip');assert.deepEqual(selected,['clip']);
  const event=h.emit('pointerdown',h.outside);let exportVisible=false;
  if(!event.defaultPrevented && !event.stopped)exportVisible=true;
  assert.equal(h.menu.open,false);assert.equal(exportVisible,true);assert.equal(h.focused(),null);
  h.menu.open=true;h.emit('focusin',h.input);assert.equal(h.menu.open,false);assert.equal(h.focused(),null);
  h.dismissal.dispose();
});

test('programmatic global panels and opened dialogs dismiss only the Clip list without stealing focus',()=>{
  const h=clipListHarness();let exportVisible=false;
  h.dismissal.close();exportVisible=true;
  assert.equal(exportVisible,true);assert.equal(h.menu.open,false);assert.equal(h.focused(),null);
  h.menu.open=true;h.emit('toggle',{open:true,matches:selector=>selector==='details'});assert.equal(h.menu.open,true);
  h.emit('toggle',{open:false,matches:selector=>selector==='dialog'});assert.equal(h.menu.open,true);
  h.emit('toggle',{open:true,matches:selector=>selector==='dialog'});assert.equal(h.menu.open,false);assert.equal(h.focused(),null);
  h.dismissal.dispose();
});

test('Clip list Escape retains form and gesture event ownership and disposal removes listeners',()=>{
  const h=clipListHarness();
  let event=h.emit('keydown',h.clip,{key:'Escape',defaultPrevented:true});assert.equal(h.menu.open,true);assert.equal(event.stopped,false);
  event=h.emit('keydown',h.input,{key:'Escape'});assert.equal(h.menu.open,false);assert.equal(event.defaultPrevented,false);assert.equal(event.stopped,false);assert.equal(h.focused(),null);
  h.menu.open=true;event=h.emit('keydown',h.clip,{key:'Escape'});assert.equal(h.menu.open,false);assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(h.focused(),h.summary);
  h.menu.open=true;h.dismissal.dispose();h.emit('pointerdown',h.outside);h.emit('keydown',h.clip,{key:'Escape'});assert.equal(h.menu.open,true);
});

test("editor shortcuts stay out of editable elements and dialogs", () => {
  assert.equal(
    isTextTarget({
      closest: (selector) => (selector.includes("input") ? {} : null),
    }),
    true,
  );
  assert.equal(isTextTarget({ closest: () => null }), false);
  assert.equal(isTextTarget(null), false);
  assert.equal(isTextTarget({ closest: (selector) => selector.includes("video") ? {} : null }), true);
});
