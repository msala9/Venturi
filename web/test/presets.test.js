import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetSelectionIdentity,presetAttributeAllowed,presetOptions,presetImportOperation,presetShortcutCatalog,presetShortcutEdit} from '../js/presets.js';

test('preset capture binding follows native selection and revision while ignoring selection order',()=>{
  const context={epoch:'e',generation:'4',timeline:'1',revision:'r',clip_ids:['2','1']};
  assert.equal(presetSelectionIdentity(context),presetSelectionIdentity({...context,clip_ids:['1','2']}));
  for(const key of ['epoch','generation','timeline','revision'])assert.notEqual(presetSelectionIdentity(context),presetSelectionIdentity({...context,[key]:'changed'}));
  assert.notEqual(presetSelectionIdentity(context),presetSelectionIdentity({...context,clip_ids:['1']}));
  assert.equal(presetSelectionIdentity(null),null);
});
test('preset settings preserve native anchors, groups and UTF-8 name limits',()=>{
  assert.deepEqual(presetOptions(' Look α ',['zoom','position'],'end',true),{name:'Look α',attributes:['zoom','position'],anchor:'end',append_filters:true});
  for(const [name,attributes,anchor] of [['', ['zoom'],'start'],['α'.repeat(65),['zoom'],'start'],['bad\nname',['zoom'],'start'],['Look',[],'start'],['Look',['zoom','zoom'],'start'],['Look',['unknown'],'start'],['Look',['zoom'],'unknown']])assert.throws(()=>presetOptions(name,attributes,anchor,false));
});
test('preset source roles expose only native property groups that can be captured',()=>{
  assert.equal(presetAttributeAllowed('volume',{video:true,audio:false}),false);
  assert.equal(presetAttributeAllowed('zoom',{video:false,audio:true}),false);
  assert.equal(presetAttributeAllowed('speed',{video:false,audio:true}),true);
  assert.equal(presetAttributeAllowed('fades',{video:true,audio:false}),true);
});
test('native preset import transports raw JSON without rounding native u64 identifiers',()=>{
  const text='{"version":1,"video":{"id":9007199254740993},"name":"<literal> α"}';
  assert.equal(presetImportOperation(text).edit.json,text);
  assert.throws(()=>presetImportOperation(''));
  assert.throws(()=>presetImportOperation('x'.repeat(4*1024*1024+1)));
});

const shortcuts={version:1,keys:['A','B','Plus','Slash','F35','Down','Space','ControlLeft'],modifiers:['Ctrl','Shift','Alt']};
test('shortcut Keep omits legacy option bytes and Remove never requires a readable native catalog',()=>{
  const options=presetOptions('Look',['zoom'],'start',false);assert.deepEqual({...options,...presetShortcutEdit('keep','unknown',['unknown'],null)},options);assert.equal(Object.hasOwn(options,'shortcut'),false);
  assert.deepEqual(presetShortcutEdit('clear',null,null,null),{shortcut:{action:'clear'}});assert.throws(()=>presetShortcutEdit('remove_implicitly'));
});

test('assigned shortcuts use the full native key catalog and canonical modifier order including Plus',()=>{
  assert.deepEqual(presetShortcutEdit('set','B',['Alt','Ctrl','Shift'],shortcuts),{shortcut:{action:'set',value:'Ctrl+Shift+Alt+B'}});
  assert.deepEqual(presetShortcutEdit('set','Plus',['Alt','Ctrl'],shortcuts),{shortcut:{action:'set',value:'Ctrl+Alt+Plus'}});
  for(const key of ['F35','Down','Space','ControlLeft'])assert.deepEqual(presetShortcutEdit('set',key,[],shortcuts),{shortcut:{action:'set',value:key}});
  for(const [key,modifiers] of [['+',['Ctrl']],['unknown',[]],['B',['Meta']],['B',['Ctrl','Ctrl']]])assert.throws(()=>presetShortcutEdit('set',key,modifiers,shortcuts));assert.throws(()=>presetShortcutEdit('set','B',['Ctrl'],null));
});

test('native shortcut catalog is bounded, versioned and preserves exact canonical keys',()=>{
  assert.deepEqual(presetShortcutCatalog(shortcuts),shortcuts);for(const patch of [{version:2},{keys:[]},{keys:['B','B']},{keys:['Bad\nkey']},{keys:Array.from({length:257},(_,i)=>`key${i}`)},{modifiers:['Alt','Ctrl','Shift']}])assert.throws(()=>presetShortcutCatalog({...shortcuts,...patch}));
});
