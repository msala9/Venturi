import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExportPanel} from '../js/export.js';
import {ApiFailure} from '../js/api.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const job=(id,state='ready')=>({id,project_epoch:`stored:${id}`,state,program:{start_frame:12,end_frame:72,width:960,height:540,audio_present:true,export_settings:{quality:23,preset:'medium'}}});
const terminalJob=(state='ready',extra={})=>({...job('9007199254740993',state),durable:true,export_revision:'a'.repeat(64),...extra});
const discardCommand='123e4567-e89b-42d3-a456-426614174000';
function harness({withPreview=false,beforePreview=()=>{}}={}){
  const original={Option:globalThis.Option,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const timers=new Map(),requests=[],cancellations=[];let sequence=0,focused=null,transportStops=0,previewContext={project_epoch:'current-project',generation:'7',timeline_id:'current-timeline',revision:'revision'};
  globalThis.setTimeout=(callback)=>{const id=++sequence;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
  globalThis.fetch=(path,options)=>{const response=deferred();cancellations.push({path,options,...response});return response.promise;};
  class Element extends EventTarget{
    constructor(){super();this.disabled=false;this.hidden=true;this.textContent='';this.value='';this.children=[];this.href='';this.open=false;this.src='';this.currentSrc='';this.paused=true;this.error=null;this.playCalls=0;this.loadCalls=0;this.pauseCalls=0;}
    replaceChildren(...children){this.children=children;}
    dispatchEvent(event){const result=super.dispatchEvent(event);this[`on${event.type}`]?.(event);return result;}
    click(){this.dispatchEvent(new Event('click'));}
    focus(){if(!this.disabled)focused=this;}
    showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
    pause(){this.paused=true;this.pauseCalls++;}load(){this.loadCalls++;this.paused=true;this.error=null;}
    removeAttribute(name){if(name==='src'){this.src='';this.currentSrc='';}}
    play(){this.playCalls++;this.paused=false;this.currentSrc=this.src;this.dispatchEvent(new Event('play'));return Promise.resolve();}
  }
  const start=new Element(),form=new Element(),status=new Element(),cancel=new Element(),refresh=new Element(),download=new Element(),history={select:new Element(),refresh:new Element(),status:new Element()};
  const discard={button:new Element(),dialog:new Element(),summary:new Element(),status:new Element(),confirm:new Element(),keep:new Element()};
  const preview={button:new Element(),video:new Element(),status:new Element()};
  form.querySelector=()=>start;form.elements={start:new Element(),end:new Element()};
  const saved=new Map(),storage={getItem:key=>saved.get(key) ?? null,setItem:(key,value)=>saved.set(key,value)};
  const panel=createExportPanel({form,status,cancel,refresh,download,history,discard,preview:withPreview?preview:null,beforePreview:()=>{transportStops++;return beforePreview();},getPreviewContext:()=>previewContext,uuid:()=>discardCommand,getState:()=>({end_frame:100}),storage,api:(path,body)=>{const response=deferred();requests.push({path,body,...response});return response.promise;}});
  function respond(path,value){const request=requests.find(request=>request.path===path && !request.responded);assert.ok(request,`Expected pending ${path}`);request.responded=true;request.resolve(value);return request;}
  return {panel,form,status,cancel,refresh,download,history,discard,preview,start,requests,cancellations,saved,timers,respond,focused:()=>focused,transportStops:()=>transportStops,setPreviewContext:value=>previewContext=value,
    async load(jobs){panel.open();respond('/exports',{jobs});await settle();},
    select(index){history.select.value=String(index);history.select.dispatchEvent(new Event('change'));},
    async prepareDiscard(value){discard.button.click();const request=requests.at(-1);assert.match(request.path,/\/exports\/[^/]+\?/);request.resolve(value);await settle();},
    escapeDiscard(){const event=new Event('cancel',{cancelable:true});if(discard.dialog.dispatchEvent(event))discard.dialog.close();return event;},
    flushTimers(){const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();},
    destroy(){for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}
const selectedState=h=>({status:h.status.textContent,hidden:h.download.hidden,href:h.download.href,label:h.download.textContent,cancel:h.cancel.disabled,start:h.start.disabled});

test('an older status response cannot replace the selected saved export or its download',async()=>{
  const h=harness();
  try{
    const a=job('export-9007199254740993','running'),b=job('export-b');await h.load([a,b]);
    h.select(0);h.refresh.click();const pending=h.requests.at(-1);assert.match(pending.path,/export-9007199254740993/);
    h.select(1);const selected=selectedState(h);assert.match(selected.href,/export-b/);assert.match(selected.status,/READY/);
    pending.resolve({...a,state:'failed',error:'Late old failure'});await settle();assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('discard is limited to durable terminal jobs and confirmation initially focuses Keep',async()=>{
  const h=harness();
  try{
    const jobs=[terminalJob('running'),terminalJob('queued'),terminalJob('discarding'),terminalJob('ready',{durability_error:true}),terminalJob('ready',{durable:false}),terminalJob()];
    await h.load(jobs);
    for(let index=0;index<jobs.length-1;index++){h.select(index);assert.equal(h.discard.button.disabled,true);const before=h.requests.length;h.discard.button.click();assert.equal(h.requests.length,before);}
    h.select(5);assert.equal(h.discard.button.disabled,false);await h.prepareDiscard(jobs[5]);
    assert.equal(h.discard.dialog.open,true);assert.equal(h.focused(),h.discard.keep);assert.match(h.discard.summary.textContent,/9007199254740993/);assert.equal(h.discard.confirm.disabled,false);
    h.escapeDiscard();assert.equal(h.discard.dialog.open,false);h.discard.confirm.click();assert.equal(h.requests.filter(request=>request.body).length,0);
  }finally{h.destroy();}
});

test('selection changes during fresh discard verification or confirmation never retarget a write',async()=>{
  const h=harness();
  try{
    const a=terminalJob(),b=terminalJob('ready',{id:'9007199254740995',project_epoch:'other:epoch'});await h.load([a,b]);h.select(0);
    h.discard.button.click();const pending=h.requests.at(-1);h.select(1);pending.resolve(a);await settle();assert.equal(h.discard.dialog.open,false);assert.equal(h.requests.filter(request=>request.body).length,0);
    h.select(0);await h.prepareDiscard(a);h.select(1);h.discard.confirm.click();assert.equal(h.discard.dialog.open,false);assert.equal(h.requests.filter(request=>request.body).length,0);assert.match(h.download.href,/9007199254740995/);
  }finally{h.destroy();}
});

test('discard success stays completed when the subsequent history refresh fails',async()=>{
  const h=harness();
  try{
    const a=terminalJob();await h.load([a]);h.select(0);await h.prepareDiscard(a);h.discard.confirm.click();
    const mutation=h.requests.at(-1);assert.equal(mutation.path,`/exports/${a.id}/discard`);assert.deepEqual(mutation.body,{project_epoch:a.project_epoch,revision:a.export_revision,command_id:discardCommand});
    assert.equal(h.discard.confirm.disabled,true);assert.equal(h.escapeDiscard().defaultPrevented,true);assert.equal(h.discard.dialog.open,true);h.discard.confirm.click();assert.equal(h.requests.filter(request=>request.body).length,1);
    mutation.resolve({id:a.id,status:'discarded',project_epoch:a.project_epoch});await settle();
    assert.equal(h.discard.dialog.open,false);assert.match(h.status.textContent,/discarded/);assert.equal(h.download.hidden,true);assert.equal(h.saved.get('venturi-export-job'),'null');assert.equal(h.focused(),h.history.select);
    h.requests.at(-1).reject(Error('Metadata unavailable'));await settle();assert.match(h.history.status.textContent,/Metadata unavailable/);assert.match(h.status.textContent,/discarded/);assert.equal(h.discard.confirm.disabled,true);
    h.discard.confirm.click();h.discard.button.click();assert.equal(h.requests.filter(request=>request.body).length,1);
  }finally{h.destroy();}
});

test('failed fresh metadata cannot open a confirmation or submit a discard',async()=>{
  const h=harness();
  try{
    const a=terminalJob();await h.load([a]);h.select(0);h.discard.button.click();h.requests.at(-1).reject(new ApiFailure('Export changed','EXPORT_CHANGED',409));await settle();
    assert.equal(h.discard.dialog.open,false);h.discard.confirm.click();assert.equal(h.requests.filter(request=>request.body).length,0);assert.match(h.status.textContent,/Export changed/);
  }finally{h.destroy();}
});

test('unknown discard outcomes cannot resubmit and leave an explicit status refresh available',async()=>{
  const h=harness();
  try{
    const a=terminalJob();await h.load([a]);h.select(0);await h.prepareDiscard(a);h.discard.confirm.click();h.requests.at(-1).reject(Error('Connection lost'));await settle();
    assert.match(h.discard.status.textContent,/outcome unknown/);assert.equal(h.discard.confirm.disabled,true);assert.equal(h.discard.keep.disabled,false);h.discard.confirm.click();assert.equal(h.requests.filter(request=>request.body).length,1);
    h.discard.keep.click();assert.equal(h.refresh.disabled,false);h.refresh.click();assert.equal(h.requests.at(-1).body,undefined);assert.match(h.requests.at(-1).path,new RegExp(`/exports/${a.id}\\?`));
  }finally{h.destroy();}
});

test('explicit HTTP discard errors preserve the server explanation and disable the old confirmation',async()=>{
  for(const code of [401,404,409]){
    const h=harness();
    try{
      const a=terminalJob();await h.load([a]);h.select(0);await h.prepareDiscard(a);h.discard.confirm.click();h.requests.at(-1).reject(new ApiFailure(`Server explanation ${code}`,'EXPORT_CHANGED',code));await settle();
      assert.match(h.discard.status.textContent,new RegExp(`Server explanation ${code}`));assert.equal(h.discard.confirm.disabled,true);assert.equal(h.discard.keep.disabled,false);h.discard.confirm.click();assert.equal(h.requests.filter(request=>request.body).length,1);
      h.discard.keep.click();assert.equal(h.refresh.disabled,false);
    }finally{h.destroy();}
  }
});

test('overlapping status refreshes keep the newest completed view within one selection',async()=>{
  const h=harness();
  try{
    const a=job('export-a','running');await h.load([a]);h.select(0);h.refresh.click();const older=h.requests.at(-1);h.refresh.click();const newer=h.requests.at(-1);
    newer.resolve({...a,state:'ready'});await settle();const selected=selectedState(h);assert.match(selected.status,/READY/);
    older.resolve(a);await settle();assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('a status response issued before cancellation cannot revive the canceled job',async()=>{
  const h=harness();
  try{
    const a=job('export-a','running');await h.load([a]);h.select(0);h.refresh.click();const older=h.requests.at(-1);h.cancel.click();
    h.cancellations[0].resolve({ok:true,json:async()=>({...a,state:'canceled'})});await settle();const selected=selectedState(h);assert.match(selected.status,/CANCELED/);
    older.resolve(a);await settle();assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('a cancellation response for a previous selection cannot change the current saved job',async()=>{
  const h=harness();
  try{
    const a=job('export-a','running'),b=job('export-b');await h.load([a,b]);h.select(0);h.cancel.click();
    assert.equal(h.cancellations.length,1);assert.equal(h.cancellations[0].options.method,'DELETE');
    h.select(1);const selected=selectedState(h);
    h.cancellations[0].resolve({ok:true,json:async()=>({...a,state:'canceled'})});await settle();
    assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('returning to the same saved export does not revive its earlier status response',async()=>{
  const h=harness();
  try{
    const a=job('export-a','running'),b=job('export-b');await h.load([a,b]);h.select(0);h.refresh.click();const pending=h.requests.at(-1);
    h.select(1);h.history.refresh.click();h.respond('/exports',{jobs:[{...a,state:'ready'},b]});await settle();h.select(0);
    const selected=selectedState(h);assert.match(selected.status,/READY/);assert.equal(selected.hidden,false);
    pending.resolve({...a,state:'running'});await settle();assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('returning to a completed export ignores an older cancellation response for that job',async()=>{
  const h=harness();
  try{
    const a=job('export-a','running'),b=job('export-b');await h.load([a,b]);h.select(0);h.cancel.click();h.select(1);
    h.history.refresh.click();h.respond('/exports',{jobs:[{...a,state:'ready'},b]});await settle();h.select(0);const selected=selectedState(h);
    h.cancellations[0].resolve({ok:true,json:async()=>({...a,state:'canceled'})});await settle();assert.deepEqual(selectedState(h),selected);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('saved export history loads only on explicit actions and rejects an oversized catalog',async()=>{
  const h=harness();
  try{
    assert.equal(h.requests.length,0);await h.load([job('export-a')]);assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
    for(let i=0;i<20;i++){h.flushTimers();await settle();}assert.equal(h.requests.length,1,'Idle history browsing must not poll');
    h.history.refresh.click();h.respond('/exports',{jobs:Array.from({length:65},(_,index)=>job(`export-${index}`))});await settle();
    assert.match(h.history.status.textContent,/browsing budget/);assert.equal(h.history.refresh.disabled,false);assert.equal(h.history.select.children.length,2,'An oversized response must not replace the last valid catalog');
    assert.equal(h.requests.length,2);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('a slower earlier history refresh cannot replace a newer explicit history result',async()=>{
  const h=harness();
  try{
    h.panel.open();const older=h.requests.at(-1);h.panel.open();const newer=h.requests.at(-1);
    newer.resolve({jobs:[job('export-new')]});await settle();assert.match(h.history.select.children[1].text,/export-new/);
    older.resolve({jobs:[job('export-old')]});await settle();assert.match(h.history.select.children[1].text,/export-new/);assert.equal(h.requests.length,2);assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('export result preview is explicit, same-origin and uses the saved export epoch without autoplay or extra API polling',async()=>{
  const h=harness({withPreview:true});try{
    const ready=job('saved-export');await h.load([ready]);h.select(0);assert.equal(h.preview.button.disabled,false);assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.playCalls,0);assert.equal(h.transportStops(),0);
    h.preview.button.click();await settle();assert.equal(h.preview.video.src,h.download.href);assert.match(h.preview.video.src,/^\/api\/v1\/exports\/saved-export\/export\.mp4\?project_epoch=stored%3Asaved-export$/);assert.equal(h.preview.video.hidden,false);assert.equal(h.preview.video.preload,'none');assert.equal(h.preview.video.controls,true);assert.equal(h.preview.video.autoplay,false);assert.equal(h.preview.video.playCalls,0);assert.equal(h.transportStops(),1);assert.match(h.preview.status.textContent,/use the video controls/);
    await h.preview.video.play();await settle();assert.equal(h.transportStops(),2);assert.equal(h.preview.video.paused,false);assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);
    let stopped=0;for(const key of [' ','ArrowRight','ArrowLeft']){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:key});event.stopPropagation=()=>stopped++;h.preview.video.dispatchEvent(event);assert.equal(event.defaultPrevented,false);}assert.equal(stopped,3);
  }finally{h.panel.close();h.destroy();}
});

test('late preview actions cannot attach an old selection, and closing the drawer releases its current video',async()=>{
  const pending=deferred(),h=harness({withPreview:true,beforePreview:()=>pending.promise});try{
    await h.load([job('export-a'),job('export-b')]);h.select(0);h.preview.button.click();assert.equal(h.preview.button.disabled,true);h.select(1);pending.resolve();await settle();assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.hidden,true);
    h.preview.button.click();await settle();assert.match(h.preview.video.src,/export-b/);const src=h.preview.video.src;
    h.preview.video.currentSrc='/api/v1/exports/export-a/export.mp4';h.preview.video.error={code:3};h.preview.video.dispatchEvent(new Event('error'));assert.equal(h.preview.video.src,src,'An old resource error must not reset the new attachment');
    await h.preview.video.play();await settle();const loads=h.preview.video.loadCalls;h.panel.close();assert.equal(h.preview.video.paused,true);assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.hidden,true);assert.ok(h.preview.video.loadCalls>loads);assert.equal(h.preview.button.disabled,true);const stops=h.transportStops();h.preview.button.click();await settle();assert.equal(h.transportStops(),stops);assert.equal(h.preview.video.src,'');
  }finally{pending.resolve();h.destroy();}
});

test('project context and status failures stop preview without changing the saved export reference',async()=>{
  const h=harness({withPreview:true});try{
    const ready=job('export-a');await h.load([ready]);h.select(0);h.preview.button.click();await settle();const reference=h.saved.get('venturi-export-job'),href=h.download.href;
    h.setPreviewContext({project_epoch:'different-project',generation:'1',timeline_id:null,revision:null});h.panel.invalidate();assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.hidden,true);assert.equal(h.saved.get('venturi-export-job'),reference);assert.equal(h.download.href,href);
    h.preview.button.click();await settle();assert.equal(h.preview.video.src,href);h.refresh.click();h.requests.at(-1).reject(Error('Metadata unavailable'));await settle();assert.equal(h.preview.video.src,'');assert.equal(h.preview.button.disabled,true);assert.equal(h.saved.get('venturi-export-job'),reference);
  }finally{h.panel.close();h.destroy();}
});

test('discard verification and native media failure release the result player and do not autoplay or replay a write',async()=>{
  const h=harness({withPreview:true});try{
    const ready=terminalJob();await h.load([ready]);h.select(0);h.preview.button.click();await settle();await h.preview.video.play();await settle();
    await h.prepareDiscard(ready);assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.paused,true);assert.equal(h.preview.button.disabled,true);const stops=h.transportStops();h.preview.button.click();await settle();assert.equal(h.transportStops(),stops);
    h.escapeDiscard();h.preview.button.click();await settle();assert.equal(h.preview.video.src,h.download.href);h.preview.video.currentSrc=h.preview.video.src;h.preview.video.error={code:3};h.preview.video.dispatchEvent(new Event('error'));assert.equal(h.preview.video.src,'');assert.equal(h.preview.video.hidden,true);assert.match(h.preview.status.textContent,/unavailable/);assert.equal(h.requests.filter(request=>request.body).length,0);assert.equal(h.preview.video.playCalls,1);
  }finally{h.panel.close();h.destroy();}
});
