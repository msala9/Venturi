import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectView,nativeProjectView} from '../js/project-view.js';

const rev=number=>number.toString(16).padStart(64,'0');
const document=()=>({project_epoch:'epoch:1',generation:'0',project_name:'Project.vvproj',unsaved:false,view_revision:rev(1),view:{active_timeline:'1',playheads:{'1':12,'2':4}},timelines:[
  {id:'1',revision:'root-revision',tracks:[{clips:[{start_frame:0,length_frames:100}]}]},
  {id:'2',revision:'child-revision',tracks:[{clips:[{start_frame:0,length_frames:50}]}]},
]});
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness({api,onView}={}){
  const state={document:document(),frame:12,ancestors:[],client_id:'writer',writable:true,stopped:true};state.timeline=state.document.timelines[0];
  const calls=[],notices=[],changes=[];let revision=1,server=structuredClone(state.document.view);
  const response=(body,extra={})=>{
    const root=body.ancestors[0]?.timeline_id || body.query.timeline_id;
    server={active_timeline:root,playheads:{...server.playheads,[root]:Math.min(root==='1'?99:49,body.query.frame)}};
    return {project_epoch:body.query.project_epoch,generation:body.query.if_generation,view:structuredClone(server),view_revision:rev(++revision),changed:true,persisted:Boolean(body.persist && !state.document.unsaved),saved:Boolean(body.persist && !state.document.unsaved),persistence_notice:null,...extra};
  };
  const controller=createProjectView({getState:()=>state,api:(path,body,options)=>{calls.push({path,body:structuredClone(body),options});return api?api(path,body,options,response):Promise.resolve(response(body));},notice:message=>notices.push(message),onView:value=>{changes.push(value);if(onView)onView(value);else Object.assign(state.document,{view:value.view,view_revision:value.view_revision});}});
  return {state,calls,notices,changes,response,controller};
}

test('native view validation retains string IDs and memory restores only at a new project epoch',async()=>{
  const h=harness();try{
    assert.equal(h.controller.activeTimeline(),'1');assert.equal(h.controller.frame('1'),12);
    h.state.writable=false;h.state.frame=30;assert.equal(await h.controller.update(),true);assert.equal(h.controller.frame('1'),30);assert.equal(h.calls.length,0);
    h.state.document={...h.state.document,view:{active_timeline:'2',playheads:{'1':1,'2':2}}};h.controller.refresh();assert.equal(h.controller.frame('1'),30);assert.equal(h.controller.activeTimeline(),'1');
    h.state.document={...h.state.document,project_epoch:'epoch:2'};h.controller.refresh();assert.equal(h.controller.frame('1'),1);assert.equal(h.controller.activeTimeline(),'2');
    for(const value of [{active_timeline:'999',playheads:{}},{active_timeline:null,playheads:{'01':1}},{active_timeline:null,playheads:{'1':-1}},{active_timeline:null,playheads:[]}])assert.throws(()=>nativeProjectView(value,h.state.document));
  }finally{h.controller.dispose();}
});

test('stopped view intents coalesce per root and serial writes use the previous authoritative view CAS',async()=>{
  const deferred=[];const h=harness({api:(path,body,options,response)=>new Promise(resolve=>deferred.push(()=>resolve(response(body))))});
  try{
    h.state.frame=20;const obsolete=h.controller.update();h.state.frame=21;const first=h.controller.update();await settle();assert.equal(await obsolete,false);assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.query.frame,21);assert.equal(h.calls[0].body.persist,false);
    h.state.frame=22;const older=h.controller.update();h.state.frame=23;const latest=h.controller.update();assert.equal(await older,false);assert.equal(h.controller.frame('1'),23);
    deferred.shift()();await first;await settle();assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.query.frame,23);assert.equal(h.calls[1].body.if_view_revision,rev(2));assert.equal(h.controller.frame('1'),23);
    deferred.shift()();assert.equal(await latest,true);assert.deepEqual(h.notices,[]);
  }finally{h.controller.dispose();}
});

test('duplicate hidden and page-leave persistence intents share one in-flight request and never create a timer',async()=>{
  let resolve;const h=harness({api:(path,body,options,response)=>new Promise(done=>resolve=()=>done(response(body)))});
  try{
    h.state.frame=40;const first=h.controller.flush({persist:true});await settle();const second=h.controller.flush({persist:true});assert.equal(first,second);assert.equal(h.calls.length,1);
    resolve();assert.equal(await first,true);assert.equal(await second,true);assert.equal(await h.controller.flush({persist:true}),true);assert.equal(h.calls.length,1);
  }finally{h.controller.dispose();}
});

test('returning to an in-flight frame removes obsolete queued heads and switching roots cannot reuse an old active-root acknowledgment',async()=>{
  const deferred=[];const h=harness({api:(path,body,options,response)=>new Promise(resolve=>deferred.push(()=>resolve(response(body))))});
  try{
    h.state.frame=20;const first=h.controller.update();await settle();
    h.state.frame=30;const obsolete=h.controller.update();h.state.frame=20;const returned=h.controller.update();
    assert.equal(returned,first);assert.equal(await obsolete,false);deferred.shift()();assert.equal(await first,true);await settle();assert.equal(h.calls.length,1);assert.equal(h.controller.frame('1'),20);
    h.state.timeline=h.state.document.timelines[1];h.state.frame=4;const second=h.controller.update();await settle();deferred.shift()();assert.equal(await second,true);
    h.state.timeline=h.state.document.timelines[0];h.state.frame=20;const back=h.controller.update();await settle();assert.equal(h.calls.length,3);assert.equal(h.calls[2].body.query.timeline_id,'1');deferred.shift()();assert.equal(await back,true);assert.equal(h.state.document.view.active_timeline,'1');
  }finally{h.controller.dispose();}
});

test('playback ticks do not write and a generation, writer or project change suppresses late view acknowledgments',async()=>{
  for(const change of [h=>h.state.stopped=false,h=>h.state.writable=false,h=>h.state.document={...h.state.document,generation:'1'},h=>h.state.document={...h.state.document,project_epoch:'other:1'}]){
    let resolve;const h=harness({api:(path,body,options,response)=>new Promise(done=>resolve=()=>done(response(body)))});
    try{
      h.state.stopped=false;assert.equal(await h.controller.update(),false);assert.equal(h.calls.length,0);
      h.state.stopped=true;h.state.frame=20;const pending=h.controller.update();await settle();change(h);resolve();assert.equal(await pending,false);assert.deepEqual(h.changes,[]);assert.deepEqual(h.notices,[]);
    }finally{h.controller.dispose();}
  }
});

test('a successful view ACK retains native CAS through playback, Save-generation and snapshot changes without publishing a stale display',async()=>{
  for(const change of [h=>h.state.stopped=false,h=>h.state.document={...h.state.document,generation:'1'},h=>h.state.document={...h.state.document}]){
    const replies=[];const h=harness({api:(path,body,options,response)=>{const value=response(body);return new Promise(resolve=>replies.push(()=>resolve(value)));}});
    try{
      h.state.frame=20;const beforePlay=h.controller.update();await settle();change(h);h.controller.refresh();replies.shift()();
      assert.equal(await beforePlay,false);assert.deepEqual(h.changes,[]);assert.equal(h.state.document.view_revision,rev(1));assert.deepEqual(h.notices,[]);
      h.state.document={...h.state.document};h.state.stopped=true;h.state.frame=99;const eof=h.controller.update();await settle();
      assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.if_view_revision,rev(2));assert.equal(h.calls[1].body.query.if_generation,h.state.document.generation);assert.equal(h.calls[1].body.query.frame,99);
      replies.shift()();assert.equal(await eof,true);assert.equal(h.changes.length,1);assert.equal(h.controller.frame('1'),99);assert.deepEqual(h.notices,[]);
    }finally{h.controller.dispose();}
  }
});

test('a delayed session snapshot cannot rewind newer locally acknowledged view revisions',async()=>{
  const h=harness();try{
    h.state.frame=20;assert.equal(await h.controller.update(),true);
    const earlier=structuredClone(h.state.document);h.state.document=structuredClone(earlier);h.controller.refresh();
    h.state.frame=30;assert.equal(await h.controller.update(),true);assert.equal(h.state.document.view_revision,rev(3));
    h.state.document=earlier;h.controller.refresh();h.state.frame=40;assert.equal(await h.controller.update(),true);
    assert.equal(h.calls.length,3);assert.equal(h.calls[2].body.if_view_revision,rev(3));assert.equal(h.calls[2].body.query.frame,40);assert.deepEqual(h.notices,[]);
  }finally{h.controller.dispose();}
});

test('an observed external view supersedes a late local ACK, and external restoration of a predecessor still requires a read after conflict',async()=>{
  let reply;const h=harness({api:(path,body,options,response)=>{const value=response(body);return new Promise(resolve=>reply=()=>resolve(value));}});
  try{
    h.state.frame=20;const pending=h.controller.update();await settle();
    h.state.document={...h.state.document,view_revision:rev(8),view:{active_timeline:'2',playheads:{'1':7,'2':11}}};h.controller.refresh();reply();assert.equal(await pending,false);
    assert.deepEqual(h.changes,[]);assert.equal(h.state.document.view_revision,rev(8));assert.equal(h.calls.length,1);
    h.state.frame=30;const next=h.controller.update();await settle();assert.equal(h.calls[1].body.if_view_revision,rev(8));reply();assert.equal(await next,true);
  }finally{h.controller.dispose();}
  let restored=false;const conflict=harness({api:(path,body,options,response)=>restored && body.if_view_revision!==rev(1)?Promise.reject(Error('VIEW_REVISION_CONFLICT')):Promise.resolve(response(body))});
  try{
    conflict.state.frame=20;assert.equal(await conflict.controller.update(),true);restored=true;
    conflict.state.document={...conflict.state.document,view_revision:rev(1)};conflict.state.frame=30;assert.equal(await conflict.controller.update(),false);
    assert.equal(conflict.calls[1].body.if_view_revision,rev(2));assert.equal(conflict.notices.length,1);assert.equal(await conflict.controller.update(),false);assert.equal(conflict.calls.length,2);
    conflict.state.document={...conflict.state.document};conflict.controller.refresh();assert.equal(await conflict.controller.update(),true);assert.equal(conflict.calls[2].body.if_view_revision,rev(1));
  }finally{conflict.controller.dispose();}
});

test('read-only nested memory calls only the existing native inverse-clock mapper and stores the root',async()=>{
  const h=harness({api:(path,body)=>Promise.resolve({project_epoch:body.query.project_epoch,generation:body.query.if_generation,source_timeline_id:'2',source_revision:'child-revision',source_frame:10,timeline_id:'1',revision:'root-revision',frame:38,via_clip_id:null})});
  try{
    h.state.writable=false;h.state.timeline=h.state.document.timelines[1];h.state.frame=10;h.state.ancestors=[{timeline_id:'1',revision:'root-revision',clip_id:'9',entry_playhead:12}];
    assert.equal(await h.controller.flush({persist:true}),true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/timelines/2/compound-navigation');assert.equal(h.calls[0].body.action.kind,'exit');assert.equal(h.controller.frame('1'),38);assert.equal(h.controller.activeTimeline(),'1');assert.deepEqual(h.changes,[]);
  }finally{h.controller.dispose();}
});

test('dirty views stay in memory until explicit Save and unchanged captures do not repeatedly request a flush',async()=>{
  const h=harness();try{
    h.state.document.unsaved=true;h.state.frame=35;assert.equal(await h.controller.flush({persist:true}),true);assert.equal(h.changes[0].persisted,false);
    assert.equal(await h.controller.flush({persist:true}),true);assert.equal(h.calls.length,1);
    h.state.document={...h.state.document,unsaved:false};h.controller.refresh();assert.equal(await h.controller.flush({persist:true}),true);assert.equal(h.calls.length,2);assert.equal(h.changes[1].persisted,true);
  }finally{h.controller.dispose();}
});

test('view CAS failures block queued writes until an authoritative refresh and never retry automatically',async()=>{
  let fail=true;const h=harness({api:(path,body,options,response)=>fail?Promise.reject(Error('VIEW_REVISION_CONFLICT')):Promise.resolve(response(body))});
  try{
    h.state.frame=44;assert.equal(await h.controller.update(),false);assert.equal(h.notices.length,1);assert.equal(await h.controller.update(),false);assert.equal(h.calls.length,1);
    fail=false;h.state.document={...h.state.document,view_revision:rev(8)};h.controller.refresh();assert.equal(await h.controller.update(),true);assert.equal(h.calls.length,2);assert.equal(h.calls[1].body.if_view_revision,rev(8));
  }finally{h.controller.dispose();}
});

test('an acknowledged view is retained when UI refresh fails, and dispose suppresses all late side effects',async()=>{
  const h=harness({onView:()=>{throw Error('detached display');}});try{h.state.frame=55;assert.equal(await h.controller.update(),true);assert.equal(h.notices.length,1);assert.equal(await h.controller.update(),true);assert.equal(h.calls.length,1);}finally{h.controller.dispose();}
  let resolve;const late=harness({api:(path,body,options,response)=>new Promise(done=>resolve=()=>done(response(body)))});late.state.frame=20;const pending=late.controller.update();await settle();late.controller.dispose();assert.equal(late.calls[0].options.signal.aborted,true);resolve();assert.equal(await pending,false);assert.deepEqual(late.changes,[]);
});

test('empty or shortened timelines clamp local memory and removed native roots are pruned without model mutation',()=>{
  const h=harness();try{
    h.controller.refresh();const before=structuredClone(h.state.document);
    h.state.document={...h.state.document,timelines:[{...h.state.document.timelines[0],tracks:[]}]};h.controller.refresh();assert.equal(h.controller.frame('1'),0);assert.equal(h.controller.frame('2'),0);
    assert.equal(before.view.playheads['1'],12);assert.equal(h.state.document.view.playheads['1'],12);
  }finally{h.controller.dispose();}
});
