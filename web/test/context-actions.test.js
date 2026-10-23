import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTimelineContext,timelineContextItems,timelineContextOperation} from '../js/timeline/context-actions.js';

function fixture(){
  const clip=(id,linked_group=null,extra={})=>({id,kind:'media',media_id:`m${id}`,linked_group,start_frame:10,length_frames:40,speed_percent:100,freeze_source_frame:null,display_color:null,retime:{pitch_correction:false},...extra});
  const timeline={id:'t',revision:'r',marker_colors:['Yellow','Red'],markers:[{id:'mark',start_frame:20,duration_frames:12,note:'Keep timing',color:'Red'}],tracks:[
    {id:'v',kind:'video',locked:false,clips:[clip('1','av'),clip('3'),clip('title',null,{kind:'title',media_id:null})]},
    {id:'a',kind:'audio',locked:false,muted:false,solo:false,armed:false,clips:[clip('2','av'),clip('4')]},
  ]};
  const document={project_epoch:'e',generation:'7',project_name:'Saved.vvproj',clipboard_count:1,clipboard_revision:'copy',media:['1','2','3','4'].map(id=>({id:`m${id}`}))};
  const options={document,timeline,selection:['3','4'],target:{kind:'clip',clip_id:'1',track_id:'v'},playhead:30,writable:true,viewIdentity:'viewport'};
  return {timeline,document,options,context:patch=>buildTimelineContext({...options,...patch})};
}
function item(context,id){const find=items=>{for(const row of items){if(row.id===id)return row;const found=row.children && find(row.children);if(found)return found;}return null;};return find(timelineContextItems(context));}

test('native context policies preserve selection and distinguish clicked, selected and linked targets',()=>{
  const f=fixture(),before=structuredClone(f.options),context=f.context();
  assert.deepEqual(context.save_ids,['1']);assert.deepEqual(context.color_ids,['1','2']);assert.deepEqual(context.media_ids,['1','2']);assert.deepEqual(context.compound_ids,['3','4']);
  assert.deepEqual(timelineContextOperation('unlink',context),{kind:'link_clips',clip_ids:['1'],unlink:true});
  assert.deepEqual(timelineContextOperation('color:Red',context),{kind:'set_display_color',clip_ids:['1','2'],color:'Red'});
  assert.equal(item(context,'compound').label,'Make compound from selection…');assert.deepEqual(f.options,before);
  const selected=f.context({selection:['2','1']});assert.deepEqual(selected.save_ids,['1','2']);assert.deepEqual(selected.compound_ids,['1','2']);
  const title=f.context({target:{kind:'clip',clip_id:'title'}});assert.equal(item(title,'speed'),null);assert.deepEqual(title.save_ids,['title']);
  assert.deepEqual(timelineContextOperation('link',f.context({target:{kind:'clip',clip_id:'3'}})),{kind:'link_clips',clip_ids:['3','4'],unlink:false});
});

test('context speed uses one native grouped preset with clicked primary and explicit overwrite',()=>{
  const f=fixture(),context=f.context({selection:['1','3'],overwrite:true});assert.deepEqual(context.media_ids,['1','3','2']);
  assert.deepEqual(timelineContextOperation('speed:50',context),{kind:'context_speed_preset',clip_id:'1',clip_ids:['1','3','2'],percent:50,overwrite:true});
  assert.equal(timelineContextOperation('speed:100',context),null);
  assert.deepEqual(timelineContextOperation('freeze',context),{kind:'set_freeze',clip_ids:['1','3','2'],frame:30});
  f.timeline.tracks[0].clips[0].freeze_source_frame=17;const frozen=f.context();
  assert.equal(timelineContextOperation('freeze',frozen),null);assert.equal(timelineContextOperation('speed:100',frozen).kind,'context_speed_preset');
  assert.equal(item(frozen,'freeze').checked,true);assert.equal(item(frozen,'speed:100').checked,false);
});

test('clip color uses native RGB metadata and Clear is enabled only for the clicked current color',()=>{
  const f=fixture();f.timeline.clip_colors=[{color:'Yellow',rgb:[240,190,50]},{color:'Red',rgb:[220,50,60]}];
  const palette=item(f.context(),'color');assert.equal(palette.layout,'swatches');assert.deepEqual(palette.children[0].swatch,[240,190,50]);assert.equal(item(f.context(),'color:default').enabled,false);
  f.timeline.tracks[0].clips[0].display_color='Red';const context=f.context();assert.equal(item(context,'color:Red').checked,true);assert.deepEqual(timelineContextOperation('color:default',context),{kind:'set_display_color',clip_ids:['1','2'],color:null});
  assert.equal(f.timeline.clip_colors[0].rgb[0],240);
});

test('locked linked peers disable atomic writes while Reveal and local retime visibility remain available',()=>{
  const f=fixture();f.timeline.tracks[1].locked=true;const context=f.context({selection:['1']});
  for(const action of ['unlink','color:Red','speed:50','freeze','compound']){assert.equal(item(context,action).enabled,false,action);assert.throws(()=>timelineContextOperation(action,context));}
  assert.equal(item(context,'reveal_media').enabled,true);assert.equal(item(context,'retime_visibility').enabled,true);
  const readOnly=f.context({writable:false});assert.equal(item(readOnly,'save_preset').enabled,false);assert.equal(item(readOnly,'reveal_media').enabled,true);
  const track=f.context({target:{kind:'track',track_id:'a'}});assert.deepEqual(timelineContextOperation('track_locked',track),{kind:'set_track',track:'a',locked:false});assert.equal(item(track,'remove_track').enabled,false);
  const independent=fixture(),other=independent.timeline.tracks[0].clips.splice(1,1)[0];independent.timeline.tracks.push({id:'locked',kind:'video',locked:true,clips:[other]});
  const selected=independent.context({selection:['1','3']});assert.equal(item(selected,'speed:50').enabled,false);assert.equal(item(selected,'unlink').enabled,true);assert.deepEqual(timelineContextOperation('unlink',selected),{kind:'link_clips',clip_ids:['1'],unlink:true});
});

test('marker actions use current playhead and preserve clicked marker timing independently of selection',()=>{
  const f=fixture(),ruler=f.context({target:{kind:'ruler',frame:999}});
  assert.deepEqual(timelineContextOperation('add_marker',ruler),{kind:'set_marker',marker:{id:null,delete:false,start_frame:30,duration_frames:0,note:'',color:'Yellow'}});
  assert.equal(item(f.context({target:{kind:'background'},playhead:20}),'add_marker').enabled,false);
  const context=f.context({target:{kind:'marker',marker_id:'mark'}});
  assert.deepEqual(timelineContextOperation('delete_marker',context),{kind:'set_marker',marker:{id:'mark',delete:true,start_frame:20,duration_frames:12,note:'Keep timing',color:'Red'}});
  assert.deepEqual(timelineContextItems(context).map(row=>row.id),['edit_marker','delete_marker']);assert.deepEqual(context.selection,['3','4']);
});

test('context ownership changes with session, selection, clock, viewport and native clipboard state',()=>{
  const f=fixture(),initial=f.context().identity;
  for(const patch of [{selection:['1']},{playhead:31},{viewIdentity:'panned'},{writable:false},{overwrite:true},{retimeVisible:['1']},{document:{...f.document,generation:'8'}},{document:{...f.document,project_epoch:'other'}},{document:{...f.document,clipboard_revision:'new'}}])assert.notEqual(f.context(patch).identity,initial);
  assert.equal(f.context({selection:['missing']}),null);assert.equal(f.context({selection:['1','1']}),null);assert.equal(f.context({target:{kind:'clip',clip_id:'missing'}}),null);assert.equal(f.context({playhead:-1}),null);
  const implicit=f.context({target:{kind:'clip',clip_id:'1'}});assert.equal(f.context({target:implicit.target}).identity,implicit.identity);
  assert.throws(()=>timelineContextOperation('color:Forged',f.context()));
});
