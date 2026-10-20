import test from "node:test";
import assert from "node:assert/strict";
import {libraryDocument,libraryMatches,sharedItemId,missingSharedUses} from "../js/library.js";

test("shared imports follow the captured document generation and preserve large seed strings",()=>{
  assert.equal(libraryDocument(null),null);
  const state={project_name:"saved.vvproj",project_epoch:"e",generation:"2"};
  assert.notEqual(libraryDocument(state),libraryDocument({...state,generation:"3"}));
  assert.notEqual(libraryDocument(state),libraryDocument({...state,project_epoch:"f"}));
  const item={id:"0123456789abcdef",kind:"video",model:"Generator",prompt:"A coastal scene",tool:"video",seed:"18446744073709551615"};
  assert.equal(libraryMatches(item,"18446744073709551615","video"),true);
  assert.equal(libraryMatches(item,"COAST","all"),true);
  assert.equal(libraryMatches(item,"coast","audio"),false);
});

test("shared recovery keeps project media IDs separate and relinks only missing uses of the selected item",()=>{
  const id="0123456789abcdef",name=`ds4-${id}-abcdef0123456789.mp4`;
  assert.equal(sharedItemId({name}),id);assert.equal(sharedItemId({name:"unrelated.mp4"}),null);
  const state={media:[{id:"42",name,offline:true},{id:"43",name,offline:false},{id:"44",name:"a.wav",offline:true,shared_origin:{item:{id}}},{id:"45",name:"unknown.mp4",offline:true}]};
  assert.deepEqual(missingSharedUses(state,id),["42","44"]);
  assert.deepEqual(missingSharedUses(state,"fedcba9876543210"),[]);
});
