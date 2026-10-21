import test from 'node:test';
import assert from 'node:assert/strict';
import {eventKeyOperation,eventGroupOperation} from '../js/eventkeys.js';
import {retainedKeySelection} from '../js/curves.js';
test('RGBA text and direction key requests preserve exact typed values and native interpolation',()=>{
  const rgba={r:.2,g:.4,b:.6,a:.8};
  const color=eventKeyOperation('c',{kind:'color'},7,12,rgba,'Bezier',[.2,.1,.8,.9]);
  assert.deepEqual(color,{kind:'edit_event_key',clip_id:'c',edit:{target:{kind:'color'},previous_source_frame:7,source_frame:12,value:rgba,interpolation:{Bezier:{c1:[.2,.1],c2:[.8,.9]}}}});
  const text='Title <literal> α\nsecond line';assert.equal(eventKeyOperation('c',{kind:'text'},null,2,text,'Hold',[]).edit.value,text);
  assert.equal(eventKeyOperation('c',{kind:'direction',filter:'GaussianBlur'},null,2,'Vertical','Linear',[]).edit.value,'Vertical');
  assert.equal(eventKeyOperation('c',{kind:'text'},-2,-2,null,'Linear',[]).edit.value,null);
  assert.throws(()=>eventKeyOperation('c',{kind:'color'},null,0,{...rgba,a:1.1},'Linear',[]));
  assert.throws(()=>eventKeyOperation('c',{kind:'text'},null,0,'α'.repeat(2049),'Hold',[]));
  assert.throws(()=>eventKeyOperation('c',{kind:'direction'},null,0,'Unknown','Hold',[]));
  assert.throws(()=>eventKeyOperation('c',{kind:'text'},null,1.5,text,'Hold',[]));
});
test('value group moves/deletes use exact source identities and recover selection after success or rejection',()=>{
  assert.deepEqual(eventGroupOperation('c',{kind:'text'},[0,10],2),{kind:'edit_event_keys',clip_id:'c',edit:{target:{kind:'text'},source_frames:[0,10],delta_source_frames:2,delete:false}});
  assert.equal(eventGroupOperation('c',{kind:'color'},[0,10],20,true).edit.delta_source_frames,0);
  for(const frames of [[],[1,1],[1.5]])assert.throws(()=>eventGroupOperation('c',{kind:'text'},frames,2));
  const pending={before:[0,10],after:[2,12]};assert.deepEqual(retainedKeySelection(pending,[0,10,20]),[0,10]);assert.deepEqual(retainedKeySelection(pending,[2,12,20]),[2,12]);
  assert.deepEqual(retainedKeySelection({before:[],after:[7]},[7]),[7]);
  assert.deepEqual(retainedKeySelection({before:[7],after:[]},[]),[]);
});
