import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMarkRange,setMarkIn,setMarkOut,markRangeContext,markRangeAction} from '../js/mark-range.js';

test('native nullable marks follow content length while explicit bounds survive temporary shortening',()=>{
  const marks={mark_in:20,mark_out:null};
  assert.deepEqual(resolveMarkRange(marks,100),{start_frame:20,end_frame:100});
  assert.deepEqual(resolveMarkRange(marks,150),{start_frame:20,end_frame:150});
  const fixed={mark_in:20,mark_out:90};
  assert.deepEqual(resolveMarkRange(fixed,10),{start_frame:10,end_frame:10});
  assert.deepEqual(resolveMarkRange(fixed,100),{start_frame:20,end_frame:90});
  assert.deepEqual(fixed,{mark_in:20,mark_out:90});
  assert.deepEqual(resolveMarkRange({},-1),{start_frame:0,end_frame:0});
});
test('native In clears an opposite Out at or before it; Out includes the current frame and clears opposite In',()=>{
  const initial={mark_in:20,mark_out:60};
  const afterIn=setMarkIn(initial,60,100);
  assert.deepEqual(afterIn,{mark_in:60,mark_out:null});
  assert.deepEqual(resolveMarkRange(afterIn,100),{start_frame:60,end_frame:100});
  assert.deepEqual(setMarkOut(afterIn,59,100),{mark_in:null,mark_out:60});
  assert.deepEqual(setMarkOut(initial,40,100),{mark_in:20,mark_out:41});
  assert.deepEqual(setMarkIn(initial,1000,100),{mark_in:100,mark_out:null});
  assert.deepEqual(setMarkOut(initial,-2,100),{mark_in:null,mark_out:0});
  assert.deepEqual(initial,{mark_in:20,mark_out:60});
});
test('Program marks survive mode and revision refresh only within the same native timeline lifecycle',()=>{
  let state=markRangeContext(null,'project:1','timeline-a');
  state.marks=setMarkIn(state.marks,12,100);
  state.marks=setMarkOut(state.marks,35,100);
  assert.deepEqual(markRangeContext(state,'project:1','timeline-a').marks,{mark_in:12,mark_out:36});
  const child=markRangeContext(state,'project:1','timeline-b');
  assert.deepEqual(child.marks,{mark_in:null,mark_out:null});
  assert.deepEqual(markRangeContext(child,'project:1','timeline-a').marks,{mark_in:null,mark_out:null});
  assert.deepEqual(markRangeContext(state,'project:2','timeline-a').marks,{mark_in:null,mark_out:null});
  assert.deepEqual(markRangeContext(state,'project:1',null),{epoch:null,timeline:null,marks:{mark_in:null,mark_out:null}});
});
test('mark shortcuts refuse editor modifiers, repeat, IME, modal and text focus',()=>{
  const event={key:'i'};
  assert.equal(markRangeAction(event),'in');assert.equal(markRangeAction({key:'O'}),'out');
  for(const flag of ['defaultPrevented','repeat','isComposing','ctrlKey','metaKey','altKey','shiftKey'])assert.equal(markRangeAction({...event,[flag]:true}),null);
  for(const flag of ['textTarget','dialogOpen'])assert.equal(markRangeAction(event,{[flag]:true}),null);
  assert.equal(markRangeAction({...event,getModifierState:name=>name==='AltGraph'}),null);
  assert.equal(markRangeAction({key:'x'}),null);
});
test('marks reject fractional or nonfinite frames rather than silently changing an insertion range',()=>{
  for(const invalid of [NaN,Infinity,1.5,'12']) {
    assert.throws(()=>setMarkIn({},invalid,100));assert.throws(()=>setMarkOut({},invalid,100));assert.throws(()=>resolveMarkRange({},invalid));
  }
});
