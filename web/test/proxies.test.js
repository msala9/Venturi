import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedProxyCatalog,createProxyControls} from '../js/proxies.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let index=0;index<16;index++)await Promise.resolve();};
const job=(state='generating',extra={})=>({id:'job-1',media_id:'1',state,progress:48,total:120,error:null,quality:'medium',source_version:'opaque-pinned-version',...extra});
const response=(extra={})=>({project_epoch:'epoch',settings:{enabled:false,quality:'medium',paused:false},jobs:[],suspended:false,...extra});

function harness(t,{api,canObserve,onPrepare}={}){
  const before={document:globalThis.document,Option:globalThis.Option};
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attributes=new Map();this.textContent='';this.disabled=false;this.checked=false;this.value='';this.classList={add:()=>{}};}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    get isConnected(){return this===body || Boolean(this.parent?.isConnected);}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
  }
  const body=new Element('body'),root=new Element('section');body.append(root);
  const document=new EventTarget();document.hidden=false;document.createElement=tag=>new Element(tag);document.createTextNode=text=>Object.assign(new Element('#text'),{textContent:text});document.querySelector=()=>null;
  globalThis.document=document;globalThis.Option=class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
  t.after(()=>{globalThis.document=before.document;globalThis.Option=before.Option;});
  let context={project_epoch:'epoch',generation:'7',media:[{id:'1',name:'Source.mov'}]},writable=true,observing=true,server=response();
  const calls=[],changes=[],notices=[],timers=new Map();let nextTimer=1;
  const controls=createProxyControls({root,getContext:()=>context,canWrite:()=>writable,canObserve:()=>observing && !document.hidden && (canObserve?.() ?? true),api:async(path,body,options={})=>{const call={path,body,options};calls.push(call);if(api)return api(call,calls.length-1);if(body)server={...server,project_epoch:body.project_epoch,settings:{enabled:body.enabled,quality:body.quality,paused:body.paused}};return structuredClone(server);},onChange:(settings,metadata)=>changes.push({settings,metadata}),onPrepare,notice:text=>notices.push(text),setTimer:(callback,ms)=>{const id=nextTimer++;timers.set(id,{callback,ms});return id;},clearTimer:id=>timers.delete(id)});
  t.after(()=>controls.dispose());
  const all=node=>[node,...node.children.flatMap(all)],find=label=>{const nodes=all(root),node=nodes.find(node=>node.attributes.get('aria-label')===label) || nodes.find(node=>node.tagName==='BUTTON' && node.textContent===label);assert.ok(node,label);return node;};
  return {controls,root,body,document,calls,changes,notices,timers,find,setServer:value=>server=value,setContext:value=>context=value,setWritable:value=>writable=value,setObserving:value=>observing=value,change(label,value){const node=find(label);if(node.tagName==='INPUT')node.checked=value;else node.value=value;node.dispatchEvent(new Event('change'));},tick(){const [id,value]=timers.entries().next().value || [];assert.ok(value,'one active poll');timers.delete(id);value.callback();return value.ms;}};
}

test('proxy catalogs retain real integer-frame progress, native quality and source binding and refuse foreign/malformed status',()=>{
  const value=response({jobs:[job()]});assert.equal(checkedProxyCatalog(value,'epoch').jobs[0].progress,48);
  for(const mutate of [value=>value.project_epoch='foreign',value=>value.settings.quality='ultra',value=>value.jobs[0].progress=121,value=>value.jobs[0].progress=.5,value=>value.jobs[0].source_version=null,value=>value.jobs.push(job()),value=>value.suspended='yes']){const invalid=structuredClone(value);mutate(invalid);assert.throws(()=>checkedProxyCatalog(invalid,'epoch'));}
  const normalized=checkedProxyCatalog(value,'epoch');normalized.settings.enabled=true;normalized.jobs[0].progress=99;assert.equal(value.settings.enabled,false);assert.equal(value.jobs[0].progress,48);
});

test('compact controls write complete settings once, report real Pause/Resume state and never enqueue or mutate the project',async t=>{
  const h=harness(t);assert.equal(h.find('Use proxies').disabled,true);h.setContext(null);assert.equal(await h.controls.refresh(),null);assert.equal(h.calls.length,0);h.setContext({project_epoch:'epoch',media:[]});await h.controls.refresh();assert.deepEqual(h.controls.settings(),{enabled:false,quality:'medium',paused:false});
  h.change('Use proxies',true);await settle();assert.deepEqual(h.calls.at(-1),{path:'/media/proxies',body:{project_epoch:'epoch',enabled:true,quality:'medium',paused:false},options:{method:'PUT'}});
  assert.equal(h.find('Proxy quality').tagName,'SELECT');h.change('Proxy quality','high');await settle();assert.equal(h.controls.settings().quality,'high');h.find('Pause proxy generation').click();await settle();assert.equal(h.controls.settings().paused,true);h.find('Resume proxy generation').click();await settle();assert.equal(h.controls.settings().paused,false);
  assert.deepEqual(h.find('Proxy quality').children.map(node=>node.value),['low','medium','high']);assert.ok(h.calls.every(call=>call.path.startsWith('/media/proxies') && !call.path.includes('prepare') && call.options.method!=='DELETE'));assert.equal(h.changes.at(-1).metadata.preferencesChanged,true);
  const settings=h.controls.settings();settings.quality='low';assert.equal(h.controls.settings().quality,'high');h.setWritable(false);h.controls.visible(true);h.change('Use proxies',false);await settle();assert.equal(h.calls.filter(call=>call.options.method==='PUT').length,4);
});

test('one active observer polls actual jobs and isolates status-only updates from preferences, with no retry of terminal failures',async t=>{
  const h=harness(t);h.setServer(response({settings:{enabled:true,quality:'medium',paused:true},jobs:[job()]}));await h.controls.refresh();assert.equal(h.timers.size,1);assert.match(h.controls.statusFor('1').label,/Paused.*48\/120 frames/);assert.equal(h.controls.statusFor('1').state,'generating');
  h.setServer(response({settings:{enabled:true,quality:'medium',paused:true},jobs:[job('ready',{progress:120})]}));assert.equal(h.tick(),1000);await settle();assert.equal(h.timers.size,0);assert.equal(h.changes.at(-1).metadata.preferencesChanged,false);assert.equal(h.controls.statusFor('1').state,'ready');
  h.setServer(response({jobs:[job('failed',{error:'PROXY_ENCODE_FAILED'})]}));await h.controls.refresh();assert.equal(h.timers.size,0);assert.match(h.controls.statusFor('1').label,/Failed.*PROXY_ENCODE_FAILED/);assert.ok(h.calls.every(call=>call.body===undefined));assert.equal(h.controls.statusFor('absent'),null);
});

test('hiding, modal policy and disposal detach observer requests without canceling native jobs or accepting late catalogs',async t=>{
  const pending=deferred(),h=harness(t,{api:()=>pending.promise});const read=h.controls.refresh();assert.equal(h.calls.length,1);await h.controls.visible(false);assert.equal(h.calls[0].options.signal.aborted,true);pending.resolve(response({jobs:[job()]}));await read;assert.equal(h.controls.statusFor('1'),null);assert.equal(h.changes.length,0);assert.equal(h.timers.size,0);assert.ok(h.calls.every(call=>call.options.method!=='DELETE'));
  await h.controls.visible(true);assert.equal(h.timers.size,1);h.setObserving(false);h.tick();await settle();assert.equal(h.timers.size,0);h.setObserving(true);await h.controls.visible(true);assert.equal(h.timers.size,1);h.controls.dispose();assert.equal(h.timers.size,0);h.change('Use proxies',true);await settle();assert.equal(h.calls.filter(call=>call.options.method==='PUT').length,0);assert.equal(h.controls.statusFor('1'),null);
});

test('settings writes serialize and supersede older GETs; epoch changes discard the old write acknowledgment and read the new project once',async t=>{
  const older=deferred(),writing=deferred(),h=harness(t,{api:(call,index)=>index===0?response():index===1?older.promise:index===2?writing.promise:response({project_epoch:'next'})});
  await h.controls.refresh();const read=h.controls.refresh();h.change('Use proxies',true);await settle();assert.equal(h.calls[1].options.signal.aborted,true);h.change('Proxy quality','low');assert.equal(h.calls.filter(call=>call.options.method==='PUT').length,1);
  older.resolve(response({settings:{enabled:false,quality:'high',paused:true}}));await read;assert.equal(h.changes.length,1);
  h.setContext({project_epoch:'next',generation:'0',media:[]});const replacement=h.controls.refresh();writing.resolve(response({settings:{enabled:true,quality:'medium',paused:false}}));await replacement;await settle();assert.equal(h.calls.length,4);assert.equal(h.changes.length,2);assert.equal(h.changes.at(-1).metadata.project_epoch,'next');assert.deepEqual(h.controls.settings(),{enabled:false,quality:'medium',paused:false});assert.equal(h.controls.statusFor('1'),null);
});

test('an unconfirmed settings write is not replayed or polled until explicit refresh, and known read errors remain honest',async t=>{
  let failWrite=true,failRead=false;const h=harness(t,{api:call=>{if(call.body && failWrite)throw Error('Connection lost');if(failRead)throw Error('Proxy service unavailable');return response({jobs:[job()]});}});
  await h.controls.refresh();h.change('Proxy quality','low');await settle();assert.match(h.notices.at(-1),/not confirmed.*Refresh before repeating/);assert.equal(h.find('Proxy quality').disabled,true);assert.equal(h.timers.size,0);h.change('Proxy quality','high');await settle();assert.equal(h.calls.filter(call=>call.options.method==='PUT').length,1);assert.equal(h.controls.statusFor('1').stale,true);
  failWrite=false;await h.controls.refresh();assert.equal(h.find('Proxy quality').disabled,false);failRead=true;h.tick();await settle();assert.equal(h.timers.size,0);assert.match(h.notices.at(-1),/service unavailable/);assert.equal(h.controls.statusFor('1').progress,48);assert.equal(h.controls.statusFor('1').stale,true);
});

test('Generate missing proxies delegates one explicit writer-owned queue intent and refreshes status without automatic retry',async t=>{
  const preparing=deferred(),intents=[],h=harness(t,{onPrepare:(context,isCurrent)=>{intents.push({context,isCurrent});return preparing.promise;}});await h.controls.refresh();assert.equal(h.find('Generate missing proxies').disabled,true);h.change('Use proxies',true);await settle();assert.equal(h.find('Generate missing proxies').disabled,false);
  h.find('Generate missing proxies').click();h.find('Generate missing proxies').click();assert.equal(intents.length,1);assert.equal(h.find('Proxy quality').disabled,true);assert.deepEqual(intents[0].context,{project_epoch:'epoch',settings:{enabled:true,quality:'medium',paused:false}});assert.equal(intents[0].isCurrent(),true);
  await h.controls.visible(false);assert.equal(h.calls.filter(call=>call.options.method==='DELETE').length,0);h.setContext({project_epoch:'next',media:[]});assert.equal(intents[0].isCurrent(),false);preparing.resolve();await settle();assert.equal(intents.length,1);assert.equal(h.calls.filter(call=>call.body).length,1,'manual generation does not masquerade as a project mutation or settings write');
});
