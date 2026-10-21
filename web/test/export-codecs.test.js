import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedExportCatalog,createExportPanel,exportRequest,exportSettingsLabel,exportPipelineLabel} from '../js/export.js';
import {ApiFailure} from '../js/api.js';

function catalog(status='not_checked'){
  const encoder=(id,label,min,max,rises,quality,presets,preset)=>({id,label,status:id==='x264'?'available':status,reason:null,quality:{min,max,rises,default:quality,label},presets,default_preset:preset});
  return {identity:'native-build:adapter-one',build:{version:'fixture-version'},adapter:{name:'Fixture GPU'},encoders:[encoder('x264','CRF',0,51,false,20,['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'],'superfast'),encoder('nvenc','CQ',0,51,false,20,['p1','p2','p3','p4','p5','p6','p7'],'p5'),encoder('vulkan','QP',0,51,false,23,[],''),encoder('videotoolbox','Quality',1,100,true,65,[],'')],decoders:[{id:'software',label:'CPU',status:'available',reason:null},{id:'nvdec',label:'NVDEC',status,reason:null},{id:'vulkan',label:'Vulkan GPU',status,reason:null}]};
}
const state={project_epoch:'epoch',if_generation:'1',timeline_id:'timeline',revision:'revision',end_frame:100,fps:{num:24,den:1}};
const values={start:'0',end:'100',width:'960',quality:'18',preset:'veryfast',audio:true};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function settle(){for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));}

test('native codec metadata is bounded and rejects unknown identities, states and invalid preset or quality scales',()=>{
  assert.equal(checkedExportCatalog(catalog()).identity,'native-build:adapter-one');
  for(const change of [value=>value.identity='',value=>value.encoders.push(value.encoders[0]),value=>value.encoders[1].id='../unsafe',value=>value.encoders[1].status='probably_available',value=>value.encoders[1].quality.default=100,value=>value.encoders[1].quality.rises='false',value=>value.encoders[2].default_preset='p1',value=>value.decoders[1].id='arbitrary-driver']){const value=catalog();change(value);assert.throws(()=>checkedExportCatalog(value));}
});

test('software defaults retain the legacy export payload and codec-specific requests use only verified native settings',()=>{
  assert.deepEqual(exportRequest(state,{...values,encoder:'x264',decoder:'software'}).settings,{quality:18,preset:'veryfast',audio:true});
  const native=catalog('available');assert.deepEqual(exportRequest(state,{...values,encoder:'nvenc',decoder:'nvdec',quality:'51',preset:'p7'},native).settings,{quality:51,preset:'p7',audio:true,encoder:'nvenc',decoder:'nvdec'});
  assert.equal(exportRequest(state,{...values,encoder:'vulkan',quality:'23',preset:''},native).settings.preset,'');assert.equal(exportRequest(state,{...values,encoder:'videotoolbox',quality:'100',preset:''},native).settings.quality,100);
  for(const patch of [{encoder:'nvenc',preset:'medium'},{encoder:'vulkan',preset:'p1'},{encoder:'videotoolbox',quality:'0',preset:''},{encoder:'nvenc',quality:'52',preset:'p5'},{encoder:'unknown'},{decoder:'unknown'},{preset:'p5'}])assert.throws(()=>exportRequest(state,{...values,...patch},native));
  for(const status of ['not_checked','checking','unavailable','disabled'])assert.throws(()=>exportRequest(state,{...values,encoder:'nvenc',preset:'p5'},catalog(status)));
  assert.throws(()=>exportRequest(state,{...values,decoder:'nvdec'}));
});

test('historic software records and new codec labels distinguish requested settings from actual decode fallback',()=>{
  assert.match(exportSettingsLabel({quality:23,preset:'medium'}),/x264 · CRF 23 medium · requested decode CPU/);
  assert.match(exportSettingsLabel({encoder:'vulkan',decoder:'vulkan',quality:23,preset:''}),/Vulkan · QP 23 · requested decode vulkan/);
  assert.match(exportSettingsLabel({encoder:'videotoolbox',quality:65,preset:''}),/VideoToolbox · Quality 65/);
  assert.match(exportPipelineLabel({encoder:'Nvenc',decoders:[{id:'nvdec',label:'NVDEC'},{id:'software',label:'CPU'}],decoder_fallback:true}),/Actual encode Nvenc · actual decode NVDEC \+ CPU · CPU decoder fallback/);
  assert.match(exportPipelineLabel({encoder:'X264',decoders:[]}),/actual decode not yet observed/);assert.doesNotMatch(exportPipelineLabel({encoder:'X264',decoders:[]}),/fallback/);
});

function harness(){
  const originals={Option:globalThis.Option,FormData:globalThis.FormData,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};let timerID=0;const timers=new Map();
  globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;this.disabled=false;}};
  globalThis.FormData=class {constructor(form){this.entries=Object.entries(form.elements).filter(([,field])=>!field.disabled).map(([key,field])=>[key,field.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}};
  globalThis.setTimeout=callback=>{const id=++timerID;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
  class Element extends EventTarget {constructor(value=''){super();this.value=value;this.disabled=false;this.hidden=false;this.textContent='';this.children=[];this.checked=true;}replaceChildren(...items){this.children=items;}click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}}
  const form=new Element(),start=new Element(),status=new Element(),cancel=new Element(),refresh=new Element(),download=new Element(),requests=[],current={...state};
  form.elements=Object.fromEntries(Object.entries({...values,encoder:'x264',decoder:'software'}).map(([key,value])=>[key,new Element(String(value))]));
  const nodes=Object.fromEntries(['[data-export-codec-status]','[data-export-probe="encoder"]','[data-export-probe="decoder"]','[data-export-codecs-refresh]','[data-export-quality-label]','[data-export-quality-hint]','[data-export-preset-field]'].map(selector=>[selector,new Element()]));
  form.querySelector=selector=>selector==='button[type=submit],#export-start'?start:nodes[selector];
  const panel=createExportPanel({form,status,cancel,refresh,download,getState:()=>current,storage:{getItem:()=>null,setItem(){}},api:(path,body)=>{const pending=deferred();requests.push({path,body,...pending});return pending.promise;}});
  return {panel,form,start,status,download,current,requests,nodes,timers,change(kind,id){form.elements[kind].value=id;form.elements[kind].dispatchEvent(new Event('change'));},probe:kind=>nodes[`[data-export-probe="${kind}"]`].click(),submit(){form.dispatchEvent(new Event('submit',{cancelable:true}));},
    async open(native=catalog()){panel.open();assert.equal(requests.at(-1).path,'/exports/codecs');requests.at(-1).resolve(native);await settle();},destroy(){for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('panel construction, opening, refresh and choices never run hardware probes or replace legacy startup quality',async()=>{
  const h=harness();try{
    assert.equal(h.requests.length,0);await h.open();assert.equal(h.form.elements.quality.value,'18');assert.equal(h.form.elements.preset.value,'veryfast');assert.equal(h.form.elements.encoder.value,'x264');assert.equal(h.start.disabled,false);assert.match(h.nodes['[data-export-codec-status]'].textContent,/fixture-version.*Fixture GPU/);
    h.change('encoder','nvenc');assert.equal(h.start.disabled,true);assert.equal(h.form.elements.quality.value,'20');assert.equal(h.form.elements.preset.value,'p5');assert.equal(h.requests.length,1);
    h.nodes['[data-export-codecs-refresh]'].click();h.requests.at(-1).resolve(catalog());await settle();assert.equal(h.requests.length,2);assert(h.requests.every(request=>request.body===undefined));assert.equal(h.form.elements.encoder.value,'nvenc');assert.equal(h.timers.size,0);
  }finally{h.destroy();}
});

test('explicit encoder changes follow native quality direction and empty-preset codecs without reusing unrelated parameters',async()=>{
  const h=harness();try{await h.open(catalog('available'));
    for(const [id,quality,preset,min,max,rising] of [['nvenc','20','p5','0','51',false],['vulkan','23','','0','51',false],['videotoolbox','65','','1','100',true],['x264','20','superfast','0','51',false]]){
      h.change('encoder',id);assert.equal(h.form.elements.quality.value,quality);assert.equal(h.form.elements.quality.min,min);assert.equal(h.form.elements.quality.max,max);assert.equal(h.form.elements.preset.value,preset);assert.equal(h.form.elements.preset.disabled,preset==='');assert.equal(h.nodes['[data-export-preset-field]'].hidden,preset==='');assert.match(h.nodes['[data-export-quality-hint]'].textContent,rising?/Higher/:/Lower/);
    }
    assert.equal(h.requests.length,1);
  }finally{h.destroy();}
});

test('only an explicit single-flight button probes selected hardware and preserves user parameters after success',async()=>{
  const h=harness();try{await h.open();h.change('encoder','nvenc');h.form.elements.quality.value='24';h.form.elements.preset.value='p6';h.probe('encoder');const pending=h.requests.at(-1);assert.deepEqual(pending.body,{kind:'encoder',id:'nvenc'});h.probe('decoder');assert.equal(h.requests.length,2);assert.equal(h.start.disabled,true);
    pending.resolve(catalog('available'));await settle();assert.equal(h.start.disabled,false);assert.equal(h.form.elements.encoder.value,'nvenc');assert.equal(h.form.elements.quality.value,'24');assert.equal(h.form.elements.preset.value,'p6');h.probe('encoder');assert.deepEqual(h.requests.at(-1).body,{kind:'encoder',id:'nvenc',force:true});h.requests.at(-1).resolve(catalog('available'));await settle();
  }finally{h.destroy();}
});

test('busy and timeout checks remain transient and software export is available without automatic fallback or retry',async()=>{
  for(const code of ['GPU_BUSY','CODEC_PROBE_BUSY','CODEC_PROBE_TIMEOUT']){
    const h=harness();try{await h.open();h.change('encoder','nvenc');h.probe('encoder');h.requests.at(-1).reject(new ApiFailure('Shared host check could not finish',code,503));await settle();assert.equal(h.form.elements.encoder.value,'nvenc');assert.equal(h.start.disabled,true);assert.match(h.nodes['[data-export-codec-status]'].textContent,new RegExp(`${code}.*no automatic retry`));assert.equal(h.requests.length,2);h.change('encoder','x264');assert.equal(h.start.disabled,false);assert.equal(h.requests.length,2);}finally{h.destroy();}
  }
});

test('disabled and checking hardware are truthful choices and unavailable results can be rechecked explicitly',async()=>{
  const h=harness();try{const native=catalog();native.encoders[2].status='disabled';native.encoders[2].reason='Hardware disabled by this server';native.decoders[1].status='checking';await h.open(native);assert.equal(h.form.elements.encoder.children.find(option=>option.value==='vulkan').disabled,true);
    h.change('encoder','vulkan');assert.equal(h.start.disabled,true);assert.equal(h.nodes['[data-export-probe="encoder"]'].disabled,true);assert.match(h.nodes['[data-export-codec-status]'].textContent,/Hardware disabled by this server/);h.change('encoder','x264');h.change('decoder','nvdec');assert.equal(h.nodes['[data-export-probe="decoder"]'].disabled,true);
    h.change('decoder','software');h.change('encoder','nvenc');h.probe('encoder');h.requests.at(-1).resolve(catalog('unavailable'));await settle();assert.equal(h.start.disabled,true);h.probe('encoder');assert.equal(h.requests.at(-1).body.force,true);h.requests.at(-1).resolve(catalog('available'));await settle();assert.equal(h.start.disabled,false);
  }finally{h.destroy();}
});

test('late checks never reselect hardware or publish across drawer close, timeline change or server identity change',async()=>{
  for(const change of ['selection','close','context','identity']){
    const h=harness();try{await h.open();h.change('encoder','nvenc');h.probe('encoder');const pending=h.requests.at(-1);if(change==='selection')h.change('encoder','x264');if(change==='close')h.panel.close();if(change==='context')h.current.revision='new-revision';const result=catalog('available');if(change==='identity')result.identity='new-server';pending.resolve(result);await settle();
      assert.equal(h.form.elements.encoder.value,change==='selection'?'x264':'nvenc');if(change==='selection')assert.equal(h.start.disabled,false);if(change==='context' || change==='identity')assert.equal(h.start.disabled,true);if(change==='identity')assert.match(h.nodes['[data-export-codec-status]'].textContent,/Server configuration changed/);assert.equal(h.requests.length,2);
    }finally{h.destroy();}
  }
});

test('late catalog reads cannot overwrite newer opens or become current after timeline changes',async()=>{
  const h=harness();try{h.panel.open();const old=h.requests.at(-1);await h.open();h.change('encoder','vulkan');old.resolve(catalog('available'));await settle();assert.equal(h.form.elements.encoder.value,'vulkan');assert.equal(h.start.disabled,true);
    h.panel.open();const stale=h.requests.at(-1);h.current.revision='changed';stale.resolve(catalog('available'));await settle();assert.match(h.nodes['[data-export-codec-status]'].textContent,/Timeline changed/);assert.equal(h.start.disabled,true);
  }finally{h.destroy();}
});

test('an unavailable catalog preserves explicit software export and omits default codec fields',async()=>{
  const h=harness();try{h.panel.open();h.requests.at(-1).reject(new ApiFailure('Old server has no codec catalog','NOT_FOUND',404));await settle();assert.equal(h.start.disabled,false);assert.match(h.nodes['[data-export-codec-status]'].textContent,/software export remains available/);h.submit();const pending=h.requests.at(-1);assert.equal(pending.path,'/exports');assert.deepEqual(pending.body.settings,{quality:18,preset:'veryfast',audio:true});pending.resolve({id:'software-export',state:'ready',program:{start_frame:0,end_frame:100,width:960,height:540,audio_present:false,export_settings:pending.body.settings}});await settle();assert.match(h.download.textContent,/x264 · CRF 18 veryfast.*silent/);assert.equal(h.requests.filter(request=>request.path.endsWith('/probe')).length,0);}finally{h.destroy();}
});

test('new exports capture verified codec choices and display saved requested settings with actual codec paths',async()=>{
  const h=harness();try{await h.open(catalog('available'));h.change('encoder','nvenc');h.change('decoder','nvdec');h.submit();const pending=h.requests.at(-1);assert.equal(pending.path,'/exports');assert.deepEqual(pending.body.settings,{quality:20,preset:'p5',audio:true,encoder:'nvenc',decoder:'nvdec'});
    pending.resolve({id:'export1',project_epoch:'epoch',state:'ready',program:{start_frame:0,end_frame:100,width:960,height:540,audio_present:true,export_settings:pending.body.settings},progress:{encoder:'Nvenc',decoders:[{id:'software',label:'CPU'}],decoder_fallback:true}});await settle();assert.match(h.status.textContent,/Actual encode Nvenc.*CPU decoder fallback.*requested NVENC · CQ 20 p5 · requested decode nvdec/);assert.match(h.download.textContent,/NVENC · CQ 20 p5/);assert.doesNotMatch(h.download.textContent,/CRF/);
  }finally{h.destroy();}
});
