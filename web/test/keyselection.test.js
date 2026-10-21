import {test} from "node:test";
import assert from "node:assert/strict";
import {keySelectionOperation,retainedCrossKeys,mergeCrossSelection} from "../js/keyselection.js";

test("cross-page selection retains hidden native picks and changes only the displayed list",()=>{
  const a={target:{kind:"transform",param:"ZoomX"},source_frame:2},b={target:{kind:"text"},source_frame:2200},c={target:{kind:"gain"},source_frame:2};
  const id=p=>JSON.stringify([p.target,p.source_frame]);
  let selection=mergeCrossSelection([], [a,c], [a,c]);
  selection=mergeCrossSelection(selection,[b],[b]);assert.deepEqual(selection,[id(a),id(c),id(b)]);
  selection=mergeCrossSelection(selection,[a,c],[c]);assert.deepEqual(selection,[id(b),id(c)]);
  assert.deepEqual(mergeCrossSelection(selection,[],[]),selection);
  assert.deepEqual(mergeCrossSelection(selection,[b],[]),[id(c)]);
  assert.throws(()=>mergeCrossSelection(Array.from({length:2048},(_,index)=>id({...a,source_frame:index})),[b],[b]));
});

test("cross-parameter operations preserve native target identities and source coordinates",()=>{
  const picks=[{target:{kind:"transform",param:"ZoomX"},source_frame:10},{target:{kind:"text"},source_frame:10}];
  const action={kind:"move",delta_source_frames:2};
  assert.deepEqual(keySelectionOperation("c",picks,action,true),{kind:"edit_key_selection",clip_id:"c",edit:{picks,link_zoom:true,action}});
  assert.equal(keySelectionOperation("c",picks,{kind:"delete"}).edit.link_zoom,false);
  for(const invalid of [[],[picks[0],picks[0]],[{...picks[0],source_frame:1.5}],Array(2049).fill(picks[0])])assert.throws(()=>keySelectionOperation("c",invalid,action));
  assert.throws(()=>keySelectionOperation("c",picks,{kind:"move",delta_source_frames:Infinity}));
  assert.throws(()=>keySelectionOperation("c",picks,{kind:"unknown"}));
});
test("selection survives rejection and tracks confirmed movement without confusing same-frame targets",()=>{
  const before=[{target:{kind:"gain"},source_frame:10},{target:{kind:"text"},source_frame:10}];
  const after=before.map(p=>({...p,source_frame:12}));
  const ids=keys=>keys.map(p=>JSON.stringify([p.target,p.source_frame]));
  const pending={before:ids(before),after:ids(after)};
  assert.deepEqual(retainedCrossKeys(pending,before),ids(before));
  assert.deepEqual(retainedCrossKeys(pending,after),ids(after));
  assert.deepEqual(retainedCrossKeys(ids(before),[before[1]]),[ids(before)[1]]);
  assert.deepEqual(retainedCrossKeys(pending,[]),[]);
});
