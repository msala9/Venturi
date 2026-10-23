import test from 'node:test';
import assert from 'node:assert/strict';
import {commandOwnerAt,createCommandOwnership,deleteCommandOwner,projectMediaDeleteOperation} from '../js/command-ownership.js';

function target({owner,region,text=false,editable=false}={}){
  return {
    isContentEditable:editable,
    closest(selector){
      if(selector==='[data-command-owner]')return owner?{dataset:{commandOwner:owner}}:null;
      if(selector==='input,textarea,select,dialog,video,audio')return text?{}:null;
      if(selector==='[contenteditable]:not([contenteditable="false"])')return editable?{}:null;
      if(selector===region)return {};
      return null;
    },
  };
}
const key=(element,patch={})=>({key:'Delete',target:element,...patch});

test('actual pool focus owns Delete while a previous timeline selection remains untouched',()=>{
  const tracker=createCommandOwnership(),media=target({owner:'media'}),timeline=target({owner:'timeline'});
  const timelineSelection=['10','11'],mediaSelection=['2','3'];
  tracker.note(timeline);tracker.note(media);
  const owner=deleteCommandOwner(key(media),{owner:tracker.owner(media)});
  assert.equal(owner,'media');
  assert.deepEqual(projectMediaDeleteOperation(mediaSelection),{kind:'edit_catalog',edit:{kind:'remove_media',media_ids:['2','3']}});
  assert.deepEqual(timelineSelection,['10','11']);
});

test('File and Edit menu pointer or keyboard focus retain the last explicit panel owner',()=>{
  const tracker=createCommandOwnership(),menu=target(),media=target({owner:'media'}),library=target({owner:'library'});
  tracker.note(media);assert.equal(tracker.note(menu),'media');assert.equal(tracker.owner(menu),'media');
  tracker.note(library);assert.equal(tracker.note(menu),'library');assert.equal(tracker.owner(menu),'library');
  assert.equal(deleteCommandOwner(key(menu),{owner:tracker.owner(menu)}),'library');
  assert.equal(tracker.reset(),'timeline');assert.equal(tracker.owner(menu),'timeline');
});

test('explicit current browser ownership overrides stale hidden Media and fixed selectors',()=>{
  const tracker=createCommandOwnership();tracker.note(target({region:'#media-list,.catalog-rows'}));
  const effects=target({owner:'library',region:'#media-list,.catalog-rows'});
  assert.equal(commandOwnerAt(effects),'library');assert.equal(tracker.note(effects),'library');
  assert.equal(commandOwnerAt(target({region:'.native-asset-panel'})),'library');
  assert.equal(commandOwnerAt(target({region:'#timeline-panel,#viewer,#inspector'})),'timeline');
});

test('key window owns nonempty keys and falls back to timeline only when its picks are empty',()=>{
  const tracker=createCommandOwnership(),keys=target({region:'[data-key-editor-window],.curve-window'});
  tracker.note(keys);assert.equal(tracker.owner(target()),'keys');
  assert.equal(deleteCommandOwner(key(keys),{owner:'keys',keysOwnDelete:true}),'keys');
  assert.equal(deleteCommandOwner(key(keys),{owner:'keys',keysOwnDelete:false}),'timeline');
  assert.equal(deleteCommandOwner(key(target()),{owner:tracker.owner(target()),keysOwnDelete:true}),'keys','Edit menu retains native key ownership');
});

test('Delete and Backspace never escape text, modal, repeat, IME or modifier guards',()=>{
  const media=target({owner:'media'});
  for(const change of [{defaultPrevented:true},{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{getModifierState:name=>name==='AltGraph'}]){
    assert.equal(deleteCommandOwner(key(media,change),{owner:'media'}),null);
  }
  for(const element of [target({text:true}),target({editable:true})])assert.equal(deleteCommandOwner(key(element),{owner:'media'}),null);
  assert.equal(deleteCommandOwner(key(media),{owner:'media',dialogOpen:true}),null);
  assert.equal(deleteCommandOwner(key(media,{key:'Backspace'}),{owner:'media'}),'media');
  assert.equal(deleteCommandOwner(key(media,{key:'Escape'}),{owner:'media'}),null);
});

test('pool empty, invalid or over-limit removal is a no-op rather than timeline fallback',()=>{
  const media=target({owner:'media'});
  for(const ids of [[],null,['1','1'],[''],Array.from({length:257},(_,index)=>String(index))]){
    assert.equal(deleteCommandOwner(key(media),{owner:'media'}),'media');
    assert.equal(projectMediaDeleteOperation(ids),null);
  }
  const ids=Array.from({length:256},(_,index)=>String(index)),operation=projectMediaDeleteOperation(ids);
  assert.equal(operation.edit.media_ids.length,256);ids[0]='changed';assert.equal(operation.edit.media_ids[0],'0');
});

test('library focus consumes removal ownership without inventing a shared-file deletion command',()=>{
  const library=target({owner:'library'});
  assert.equal(deleteCommandOwner(key(library),{owner:'library'}),'library');
  assert.equal(deleteCommandOwner(key(library,{key:'Backspace'}),{owner:'library'}),'library');
  assert.equal(projectMediaDeleteOperation([]),null);
});
