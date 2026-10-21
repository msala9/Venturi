import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExportPanel} from '../js/export.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const job=(id,state='ready')=>({id,project_epoch:`stored:${id}`,state,program:{start_frame:12,end_frame:72,width:960,height:540,audio_present:true,export_settings:{quality:23,preset:'medium'}}});
function harness(){
  const original={Option:globalThis.Option,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const timers=new Map(),requests=[],cancellations=[];let sequence=0;
  globalThis.setTimeout=(callback)=>{const id=++sequence;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
  globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
  globalThis.fetch=(path,options)=>{const response=deferred();cancellations.push({path,options,...response});return response.promise;};
  class Element extends EventTarget{
    constructor(){super();this.disabled=false;this.hidden=true;this.textContent='';this.value='';this.children=[];this.href='';}
    replaceChildren(...children){this.children=children;}
    dispatchEvent(event){const result=super.dispatchEvent(event);this[`on${event.type}`]?.(event);return result;}
    click(){this.dispatchEvent(new Event('click'));}
  }
  const start=new Element(),form=new Element(),status=new Element(),cancel=new Element(),refresh=new Element(),download=new Element(),history={select:new Element(),refresh:new Element(),status:new Element()};
  form.querySelector=()=>start;form.elements={start:new Element(),end:new Element()};
  const saved=new Map(),storage={getItem:key=>saved.get(key) ?? null,setItem:(key,value)=>saved.set(key,value)};
  const panel=createExportPanel({form,status,cancel,refresh,download,history,getState:()=>({end_frame:100}),storage,api:(path,body)=>{const response=deferred();requests.push({path,body,...response});return response.promise;}});
  function respond(path,value){const request=requests.find(request=>request.path===path && !request.responded);assert.ok(request,`Expected pending ${path}`);request.responded=true;request.resolve(value);return request;}
  return {panel,form,status,cancel,refresh,download,history,start,requests,cancellations,saved,timers,respond,
    async load(jobs){panel.open();respond('/exports',{jobs});await settle();},
    select(index){history.select.value=String(index);history.select.dispatchEvent(new Event('change'));},
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
