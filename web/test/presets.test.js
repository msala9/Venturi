import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presetSelectionIdentity,presetAttributeAllowed,presetOptions,presetImportOperation} from '../js/presets.js';

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
