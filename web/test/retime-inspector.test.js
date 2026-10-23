import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderRetime,retimePropertySelection,compoundSelectionOperation} from '../js/inspector.js';

const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness({selected=false,commit}={}){
  const previousDocument=globalThis.document,previousOption=globalThis.Option,previousWindow=globalThis.window,commands=[],notices=[],controllers=[],windowEvents=new Map(),documentEvents=new Map();
  const events=map=>({addEventListener(type,handler){if(!map.has(type))map.set(type,new Set());map.get(type).add(handler);},removeEventListener(type,handler){map.get(type)?.delete(handler);if(!map.get(type)?.size)map.delete(type);}});
  const windowRef=events(windowEvents);
  class Node {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.handlers=new Map();this.isConnected=false;this.ownerDocument=globalThis.document;this.captured=new Set();}
    append(...nodes){const connect=(node,value)=>{node.isConnected=value;for(const child of node.children)connect(child,value);};this.children.push(...nodes);for(const node of nodes)connect(node,this.isConnected);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(type,handler){this.handlers.set(type,handler);}
    removeEventListener(type,handler){if(this.handlers.get(type)===handler)this.handlers.delete(type);}
    emit(type,extra={}){const event={button:0,pointerId:1,buttons:1,clientX:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};this.handlers.get(type)?.(event);return event;}
    setPointerCapture(id){this.captured.add(id);}
    hasPointerCapture(id){return this.captured.has(id);}
    releasePointerCapture(id){this.captured.delete(id);this.emit('lostpointercapture',{pointerId:id});}
    reportValidity(){return true;}
    focus(){document.activeElement=this;}
  }
  globalThis.window=windowRef;globalThis.document={createElement:tag=>new Node(tag),activeElement:null,defaultView:windowRef,...events(documentEvents)};globalThis.Option=function(text,value){const node=new Node('option');node.textContent=text;node.value=value;return node;};
  const root=new Node('div'),state=new Map([['retime',true],['retime-focus','clip']]);root.isConnected=true;
  const detail={clip_id:'clip',display_colors:['Blue'],display_color:null,retime:{speed_percent:125.375,pitch_correction:true,freeze_source_frame:null}};
  let current=true,frame=75,selection={project_epoch:'epoch',generation:'1',timeline_id:'timeline',revision:'revision',selection:['clip','peer'],clip_ids:['clip','peer']};
  const render=(disabled=false,options={})=>{const control=renderRetime(root,detail,disabled,()=>frame,operation=>{commands.push(operation);return commit?.(operation);},state,()=>current,{...(selected?{selection:structuredClone(selection),getSelection:()=>selection,frame,labelControls:false}:{}),notice:message=>notices.push(message),...options});if(control)controllers.push(control);return control;};
  const all=()=>{const nodes=[];const visit=node=>{nodes.push(node);for(const child of node.children)visit(child);};visit(root);return nodes;};
  const fire=(map,type)=>{for(const handler of [...(map.get(type) || [])])handler({});};
  return {root,state,detail,commands,notices,render,all,windowEvents,documentEvents,windowEvent:type=>fire(windowEvents,type),documentEvent:type=>fire(documentEvents,type),setCurrent:value=>{current=value;},setFrame:value=>{frame=value;},setSelection:value=>{selection=value;},getSelection:()=>selection,restore(){for(const control of controllers)control.dispose();for(const node of all())node.isConnected=false;globalThis.document=previousDocument;globalThis.Option=previousOption;globalThis.window=previousWindow;}};
}

test('advanced speed opens with native Ripple, exact primary speed and pitch without applying edits',async()=>{
  const h=harness();try{
    h.render();await Promise.resolve();
    const percent=h.all().find(node=>node.tagName==='input' && node.type==='number'),fit=h.all().find(node=>node['aria-label']==='Speed duration policy');
    assert.equal(percent.value,125.375);assert.equal(percent.disabled,false);assert.equal(fit.value,'ripple');assert.equal(h.commands.length,0);assert.equal(document.activeElement,percent);assert.equal(h.state.has('retime-focus'),false);
    percent.value=50;h.all().find(node=>node.tagName==='form').emit('submit');
    await settle();
    assert.deepEqual(h.commands,[{kind:'set_speed',clip_ids:['clip'],percent:50,pitch_correction:true,fit:'ripple'}]);
  }finally{h.restore();}
});

test('advanced speed presets change only the local percentage and Apply submits the selected group once',async()=>{
  const h=harness({selected:true});try{
    h.render();const percent=h.all().find(node=>node['aria-label']==='Speed percent'),fit=h.all().find(node=>node['aria-label']==='Speed duration policy'),pitch=h.all().find(node=>node.type==='checkbox');
    fit.value='keep_length';pitch.checked=false;
    for(const value of [50,100,200]){
      h.all().find(node=>node['aria-label']===`Draft speed ${value}%`).emit('click');
      assert.equal(Number(percent.value),value);assert.equal(fit.value,'keep_length');assert.equal(pitch.checked,false);
      assert.deepEqual(h.commands,[]);
      assert.equal(h.all().find(node=>node['aria-label']===`Draft speed ${value}%`)['aria-pressed'],'true');
    }
    const form=h.all().find(node=>node.tagName==='form');form.emit('submit');form.emit('submit');await settle();
    assert.deepEqual(h.commands,[{kind:'set_speed',clip_ids:['clip','peer'],percent:200,pitch_correction:false,fit:'keep_length'}]);
  }finally{h.restore();}
});

test('advanced speed scrubbing uses one percent per pixel, fine Shift and two decimals without committing on release',async()=>{
  const h=harness({selected:true});try{
    h.render();const percent=h.all().find(node=>node['aria-label']==='Speed percent');
    assert.equal(Number(percent.value),125.375);
    percent.emit('pointerdown',{clientX:0});percent.emit('pointermove',{clientX:10});
    assert.equal(Number(percent.value),135.38);assert.deepEqual(h.commands,[]);
    percent.emit('pointerup',{clientX:12,buttons:0});assert.equal(Number(percent.value),137.38);assert.deepEqual(h.commands,[]);assert.equal(percent.captured.size,0);
    percent.value='100';percent.emit('pointerdown',{clientX:0});percent.emit('pointermove',{clientX:10,shiftKey:true});
    percent.emit('pointerup',{clientX:15,shiftKey:true,buttons:0});assert.equal(Number(percent.value),101.5);assert.deepEqual(h.commands,[]);
    h.all().find(node=>node.tagName==='form').emit('submit');await settle();
    assert.deepEqual(h.commands,[{kind:'set_speed',clip_ids:['clip','peer'],percent:101.5,pitch_correction:true,fit:'ripple'}]);
  }finally{h.restore();}
});

test('Cancel speed changes restores exact initial precision, pitch and Ripple without editing; modal Escape remains owned by its dialog',()=>{
  const h=harness({selected:true});try{
    h.render();const percent=h.all().find(node=>node['aria-label']==='Speed percent'),fit=h.all().find(node=>node['aria-label']==='Speed duration policy'),pitch=h.all().find(node=>node.type==='checkbox'),form=h.all().find(node=>node.tagName==='form');
    h.all().find(node=>node['aria-label']==='Draft speed 50%').emit('click');fit.value='resize';pitch.checked=false;
    h.all().find(node=>node.textContent==='Cancel speed changes').emit('click');
    assert.equal(Number(percent.value),125.375);assert.equal(fit.value,'ripple');assert.equal(pitch.checked,true);assert.deepEqual(h.commands,[]);
    percent.value='72.5';const escape=form.emit('keydown',{key:'Escape'});assert.equal(escape.defaultPrevented,true);assert.equal(escape.stopped,true);assert.equal(Number(percent.value),125.375);
    assert.equal(form.emit('keydown',{key:' '}).stopped,true);assert.equal(form.emit('keydown',{key:'Enter'}).stopped,true);
    assert.equal(Boolean(form.emit('keydown',{key:'z',ctrlKey:true}).stopped),false);
  }finally{h.restore();}
  const modal=harness({selected:true});try{
    const control=modal.render(false,{cancelButton:false}),form=modal.all().find(node=>node.tagName==='form');
    assert.equal(modal.all().some(node=>node.textContent==='Cancel speed changes'),false);
    assert.equal(Boolean(form.emit('keydown',{key:'Escape'}).defaultPrevented),false);
    control.dispose();assert.deepEqual(modal.commands,[]);
  }finally{modal.restore();}
});

test('advanced speed scrubs cancel on stale owners, collapse, hidden documents and capture loss before any native edit',()=>{
  const changes=[
    h=>h.setCurrent(false),h=>h.setFrame(76),h=>h.setSelection({...h.getSelection(),revision:'changed'}),
    h=>{h.root.isConnected=false;},h=>{const section=h.all().find(node=>node.dataset.visualPath==='retime');section.open=false;section.emit('toggle');},
    h=>{document.hidden=true;h.documentEvent('visibilitychange');},h=>h.windowEvent('blur'),
    (h,percent)=>percent.emit('pointercancel'),(h,percent)=>percent.emit('lostpointercapture'),
    (h,percent)=>percent.emit('keydown',{key:'Escape'}),
  ];
  for(const change of changes){
    const h=harness({selected:true});try{
      h.render();const percent=h.all().find(node=>node['aria-label']==='Speed percent');
      percent.emit('pointerdown',{clientX:0});percent.emit('pointermove',{clientX:10});change(h,percent);
      percent.emit('pointerup',{clientX:20,buttons:0});assert.equal(Number(percent.value),125.375);assert.deepEqual(h.commands,[]);assert.equal(percent.captured.size,0);
    }finally{h.restore();}
  }
});

test('advanced speed dispose removes every owned listener and prevents delayed focus or detached submit',async()=>{
  for(const selected of [false,true]){
    const h=harness({selected});try{
      const control=h.render(),percent=h.all().find(node=>node['aria-label']==='Speed percent'),form=h.all().find(node=>node.tagName==='form');
      assert.equal(h.windowEvents.get('blur').size,1);assert.equal(h.documentEvents.get('visibilitychange').size,1);
      percent.emit('pointerdown',{clientX:0});percent.emit('pointermove',{clientX:8});control.dispose();control.dispose();await settle();
      assert.equal(Number(percent.value),125.375);assert.equal(percent.captured.size,0);assert.equal(document.activeElement,null);
      assert.equal(h.windowEvents.size,0);assert.equal(h.documentEvents.size,0);assert.equal(percent.handlers.size,0);assert.equal(form.handlers.size,0);
      form.emit('submit');h.windowEvent('blur');assert.deepEqual(h.commands,[]);
    }finally{h.restore();}
  }
  const h=harness({selected:true});try{
    const control=h.render();h.all().find(node=>node.tagName==='form').emit('submit');control.dispose();await settle();
    assert.deepEqual(h.commands,[]);assert.deepEqual(h.notices,[]);
  }finally{h.restore();}
});

test('selected retime targets use native lane and ClipId order, filtering generators and locked lanes without linked expansion',()=>{
  const snapshot={project_epoch:'epoch',generation:'1',timeline:{id:'timeline',revision:'revision',tracks:[
    {kind:'video',locked:false,clips:[{id:'9',kind:'media',start_frame:0},{id:'2',kind:'media',start_frame:80,linked_group:'group'},{id:'solid',kind:'solid'},{id:'not-selected',kind:'media',linked_group:'group'}]},
    {kind:'audio',locked:false,clips:[{id:'audio',kind:'media',start_frame:0}]},
    {kind:'audio',locked:true,clips:[{id:'locked',kind:'media',linked_group:'group'}]},
  ]},selection:['solid','9','locked','audio','2']};
  const before=structuredClone(snapshot);
  assert.deepEqual(retimePropertySelection(snapshot).clip_ids,['2','9','audio']);assert.deepEqual(snapshot,before);
  snapshot.selection=['solid','locked'];assert.equal(retimePropertySelection(snapshot),null);
  snapshot.selection=['2','missing'];assert.equal(retimePropertySelection(snapshot),null);
  snapshot.selection=['2','2'];assert.equal(retimePropertySelection(snapshot),null);
});

test('selected speed forwards every explicit media target once and keeps native duration and pitch choices',async()=>{
  let finish;const h=harness({selected:true,commit:()=>new Promise(resolve=>{finish=resolve;})});try{
    h.render();const percent=h.all().find(node=>node.tagName==='input' && node.type==='number'),fit=h.all().find(node=>node['aria-label']==='Speed duration policy'),pitch=h.all().find(node=>node.type==='checkbox');
    percent.value='62.5';fit.value='resize';pitch.checked=false;
    const form=h.all().find(node=>node.tagName==='form');form.emit('submit');form.emit('submit');await settle();
    assert.deepEqual(h.commands,[{kind:'set_speed',clip_ids:['clip','peer'],percent:62.5,pitch_correction:false,fit:'resize'}]);
    assert.ok(h.all().filter(node=>node.tagName==='button').every(node=>node.disabled));
    finish();await settle();assert.equal(percent.disabled,false);
    assert.equal(h.all().some(node=>node['aria-label']==='Clip display color'),false);
  }finally{h.restore();}
});

test('selected Freeze sends raw playhead for native per-clip clamping and Unfreeze retains the full explicit target list',async()=>{
  const h=harness({selected:true});try{
    h.setFrame(900);h.render();h.all().find(node=>node.textContent==='Freeze at playhead').emit('click');await settle();
    h.all().find(node=>node.textContent==='Unfreeze').emit('click');await settle();
    assert.deepEqual(h.commands,[{kind:'set_freeze',clip_ids:['clip','peer'],frame:900},{kind:'set_freeze',clip_ids:['clip','peer'],frame:null}]);
  }finally{h.restore();}
});

test('selected retime rejects stale peer selection, playhead, epoch, detached roots and blocked editing before or during dispatch',async()=>{
  for(const before of [false,true])for(const change of [h=>h.setSelection({...h.getSelection(),selection:['clip'],clip_ids:['clip']}),h=>h.setSelection({...h.getSelection(),project_epoch:'next'}),h=>h.setFrame(76),h=>{h.root.isConnected=false;},h=>h.setCurrent(false)]){
    const h=harness({selected:true});try{
      h.render();if(before)change(h);h.all().find(node=>node.tagName==='form').emit('submit');if(!before)change(h);await settle();assert.deepEqual(h.commands,[]);assert.equal(h.notices.length,1);
    }finally{h.restore();}
  }
});

test('selected speed invalid numeric drafts never become zero and opening controls never mutates',async()=>{
  const h=harness({selected:true});try{
    h.render();await settle();assert.deepEqual(h.commands,[]);
    const percent=h.all().find(node=>node.tagName==='input' && node.type==='number'),form=h.all().find(node=>node.tagName==='form');
    for(const value of ['', ' ', 'Infinity','bad','0','10001']){percent.value=value;form.emit('submit');await settle();}assert.deepEqual(h.commands,[]);
  }finally{h.restore();}
});

test('unknown retime outcome stays latched and cannot replay through Freeze or repeated Apply',async()=>{
  const h=harness({selected:true,commit:()=>Promise.reject(Object.assign(Error('Outcome unknown; resolve the command'),{code:'OUTCOME_UNKNOWN'}))});try{
    h.render();h.all().find(node=>node.tagName==='form').emit('submit');await settle();
    h.all().find(node=>node.tagName==='form').emit('submit');h.all().find(node=>node.textContent==='Freeze at playhead').emit('click');await settle();
    assert.equal(h.commands.length,1);assert.deepEqual(h.notices,['Outcome unknown; resolve the command']);assert.ok(h.all().filter(node=>node.tagName==='button').every(node=>node.disabled));
  }finally{h.restore();}
});

test('legacy clip label remains singular while its duplicate speed controls can be hidden',async()=>{
  const h=harness();try{
    h.render(false,{speedControls:false});assert.equal(h.all().some(node=>node.tagName==='form'),false);
    h.all().find(node=>node['aria-label']==='Clip display color').value='Blue';h.all().find(node=>node.textContent==='Apply clip label').emit('click');await settle();
    assert.deepEqual(h.commands,[{kind:'set_display_color',clip_ids:['clip'],color:'Blue'}]);
  }finally{h.restore();}
});

test('compound grouping defaults explicitly to native with an opt-in legacy audio mix operation',()=>{
  const ids=['video','audio'];assert.deepEqual(compoundSelectionOperation(ids,'Compound'),{kind:'make_native_compound',clip_ids:ids,name:'Compound'});
  assert.deepEqual(compoundSelectionOperation(ids,'Mix','keep_track_audio_mix'),{kind:'make_compound',clip_ids:ids,name:'Mix'});
  const operation=compoundSelectionOperation(ids,'Compound');ids.push('later');assert.deepEqual(operation.clip_ids,['video','audio']);
  for(const args of [[[],'Name'],[['a','a'],'Name'],[['a'],' '],[['a'],'Name','unknown']])assert.throws(()=>compoundSelectionOperation(...args));
  assert.equal(compoundSelectionOperation(Array.from({length:4096},(_,index)=>String(index)),'Large').clip_ids.length,4096);
});

test('removed or disabled speed controls cannot edit a replacement clip or session',()=>{
  for(const disabled of [false,true]){
    const h=harness();try{
      h.render(disabled);h.setCurrent(false);h.all().find(node=>node.tagName==='form').emit('submit');
      for(const node of h.all().filter(node=>node.tagName==='button'))node.emit('click');assert.equal(h.commands.length,0);
    }finally{h.restore();}
  }
});
