import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFolderCatalog,nativeFolderChoices,nativeFolderFilter,nativeFolderOperation} from '../js/native-asset-folders.js';

const revision='a'.repeat(64);
const value=()=>({project_epoch:'epoch',version:1,folders_revision:revision,folders:[{id:'outer',name:'Shots',parent:null},{id:'inner',name:'Day 1',parent:'outer'},{id:'other',name:'Shots',parent:null}]});

test('native folders retain duplicate display names and distinguish All, Root and an exact folder',()=>{
  const tree=nativeFolderCatalog(value(),'epoch');
  assert.deepEqual(nativeFolderFilter(tree,null),{});
  assert.deepEqual(nativeFolderFilter(tree,''),{folder:'',folders_revision:revision});
  assert.deepEqual(nativeFolderFilter(tree,'inner'),{folder:'inner',folders_revision:revision});
  assert(nativeFolderChoices(tree).some(item=>item.value==='inner' && item.label==='Shots / Day 1'));
  assert.equal(nativeFolderChoices(tree).filter(item=>item.label==='Shots').length,2);
  assert.deepEqual(nativeFolderCatalog({...value(),folders:[],folders_revision:'absent'},'epoch').folders,[]);
});

test('malformed, foreign, orphaned, duplicate and cyclic folder responses cannot enable editing',()=>{
  for(const patch of [{project_epoch:'old'},{version:2},{folders_revision:'unknown'},{folders:[{id:'../path',name:'Bad',parent:null}]},{folders:[{id:'a',name:'Bad',parent:'missing'}]},{folders:[{id:'a',name:'A',parent:null},{id:'a',name:'B',parent:null}]},{folders:[{id:'a',name:'A',parent:'b'},{id:'b',name:'B',parent:'a'}]}])assert.throws(()=>nativeFolderCatalog({...value(),...patch},'epoch'));
  const folders=Array.from({length:16},(_,index)=>({id:`f${index}`,name:`Folder ${index}`,parent:index?`f${index-1}`:null}));
  assert.equal(nativeFolderCatalog({...value(),folders},'epoch').folders.length,16);
  assert.throws(()=>nativeFolderCatalog({...value(),folders:[...folders,{id:'f16',name:'Too deep',parent:'f15'}]},'epoch'));
});

test('folder edits carry only current catalog revisions and exact native operation fields',()=>{
  const tree=nativeFolderCatalog(value(),'epoch');
  assert.deepEqual(nativeFolderOperation('create_folder',tree,{name:'  New  ',parent:'outer'}),{action:'create_folder',folders_revision:revision,name:'New',parent:'outer'});
  assert.deepEqual(nativeFolderOperation('rename_folder',tree,{id:'inner',name:'Day 2'}),{action:'rename_folder',folders_revision:revision,id:'inner',name:'Day 2'});
  assert.deepEqual(nativeFolderOperation('remove_folder',tree,{id:'outer'}),{action:'remove_folder',folders_revision:revision,id:'outer'});
  assert.deepEqual(nativeFolderOperation('move_folder',tree,{id:'inner',parent:''}),{action:'move_folder',folders_revision:revision,id:'inner',parent:null});
  assert.throws(()=>nativeFolderOperation('rename_folder',tree,{id:'missing',name:'X'}));
  for(const control of ['\u0001','\u007f','\u0085','\u009f']){
    assert.throws(()=>nativeFolderOperation('create_folder',tree,{name:`Folder${control}name`,parent:null}));
    assert.throws(()=>nativeFolderCatalog({...value(),folders:[{id:'a',name:`Folder${control}name`,parent:null}]},'epoch'));
  }
  assert.throws(()=>nativeFolderOperation('create_folder',tree,{name:'😀'.repeat(33),parent:null}));
});

test('folder destinations account for a moved subtree and leave deepest folders available to assets',()=>{
  const folders=Array.from({length:16},(_,index)=>({id:`f${index}`,name:`Folder ${index}`,parent:index?`f${index-1}`:null}));
  folders.push({id:'outer',name:'Outer',parent:null},{id:'inner',name:'Inner',parent:'outer'});
  const tree=nativeFolderCatalog({...value(),folders},'epoch');
  assert(nativeFolderChoices(tree).some(item=>item.value==='f15'));
  assert(nativeFolderChoices(tree,'outer').some(item=>item.value==='f13'));
  assert(!nativeFolderChoices(tree,'outer').some(item=>['f14','f15'].includes(item.value)));
  assert.throws(()=>nativeFolderOperation('move_folder',tree,{id:'outer',parent:'f14'}));
  assert.throws(()=>nativeFolderOperation('create_folder',tree,{name:'Too deep',parent:'f15'}));
  assert.equal(nativeFolderOperation('create_folder',tree,{name:'Level sixteen',parent:'f14'}).parent,'f14');
});

test('folder destinations exclude self and descendants while keeping sibling names distinct',()=>{
  const tree=nativeFolderCatalog(value(),'epoch');
  assert.deepEqual(nativeFolderChoices(tree,'outer').map(item=>item.value),['','other']);
  assert.throws(()=>nativeFolderOperation('move_folder',tree,{id:'outer',parent:'inner'}));
  assert.throws(()=>nativeFolderOperation('move_folder',tree,{id:'outer',parent:'outer'}));
  assert.deepEqual(nativeFolderOperation('move_folder',tree,{id:'outer',parent:'other'}),{action:'move_folder',folders_revision:revision,id:'outer',parent:'other'});
});

test('moving assets binds each raw library revision without browser conversion or changes to input selection',()=>{
  const tree=nativeFolderCatalog(value(),'epoch'),items=[{id:'asset-a',revision},{id:'asset-b',revision:'b'.repeat(64)}],before=structuredClone(items);
  assert.deepEqual(nativeFolderOperation('move_assets',tree,{items,folder:'inner'}),{action:'move_assets',folders_revision:revision,items,folder:'inner'});
  assert.deepEqual(items,before);
  for(const invalid of [[],[items[0],items[0]],[{id:'../outside',revision}],[{id:'asset-a',revision:'old'}]])assert.throws(()=>nativeFolderOperation('move_assets',tree,{items:invalid,folder:null}));
  assert.throws(()=>nativeFolderOperation('move_assets',tree,{items,folder:'missing'}));
});
