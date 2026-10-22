import test from "node:test";
import assert from "node:assert/strict";
import {bindColorWheel,wheelDelta} from "../js/visual.js";
import {renderSelectedVideoEffects} from '../js/inspector.js';
test("wheel pointer movement stays local and commits exactly once; cancel never commits",async()=>{
  const events={},commits=[],draws=[];
  const canvas={addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...point)=>draws.push(point),onCommit:async(x,y)=>commits.push([x,y]),onError(){}});
  const point=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(20,20));events.pointermove(point(60,30));events.pointermove(point(90,50));assert.equal(commits.length,0);
  events.pointerup();await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);assert.ok(Math.hypot(...commits[0])<=1);
  events.pointerdown(point(10,10));events.pointermove(point(140,140));events.keydown({key:"Escape",stopPropagation(){},preventDefault(){}});events.pointerup();assert.equal(commits.length,1);
  events.pointerdown(point(10,10));events.pointermove(point(100,100));events.lostpointercapture();events.pointerup();assert.equal(commits.length,1);
});
test("wheel coordinates use the native unit disc and Shift gives fine travel",()=>{
  assert.ok(Math.abs(Math.hypot(...wheelDelta(0,0,1000,1000,69))-1)<1e-9);
  assert.equal(wheelDelta(0,0,20,0,100,true)[0],wheelDelta(0,0,20,0,100)[0]*0.2);
});

test('wheel guards cancel stale pointer drafts and reject detached or newly blocked release without a command',async()=>{
  const events={},commits=[],draws=[];let allowed=true,captured=false,released=0;
  const canvas={isConnected:true,addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;released++;events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...point)=>draws.push(point),onCommit:async(x,y)=>commits.push([x,y]),onError(){},canInteract:()=>allowed});
  const point=(x,y)=>({button:0,buttons:1,pointerId:1,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(10,10));events.pointermove(point(50,20));allowed=false;events.pointermove(point(70,30));events.pointerup({pointerId:1});assert.equal(released,1);assert.equal(commits.length,0);assert.deepEqual(draws.at(-1),[0,0,false]);
  allowed=true;events.pointerdown(point(10,10));events.pointermove(point(60,30));events.pointerup({pointerId:1});allowed=false;await Promise.resolve();await Promise.resolve();assert.equal(commits.length,0);
  allowed=true;events.pointerdown(point(10,10));events.pointermove(point(60,30));events.pointerup({pointerId:1});await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);
  canvas.isConnected=false;events.pointerdown(point(10,10));events.keydown({key:'ArrowRight',preventDefault(){},stopPropagation(){}});events.dblclick();await Promise.resolve();assert.equal(commits.length,1);
});

test('wheel shares one pending native action and ignores unrelated pointers or a second release',async()=>{
  const events={},commits=[];let resolve,captures=0;
  const canvas={addEventListener:(type,fn)=>{events[type]=fn;},focus(){},setPointerCapture(){captures++;},releasePointerCapture(){events.lostpointercapture();},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint(){},onCommit:(x,y)=>{commits.push([x,y]);return new Promise(done=>{resolve=done;});},onError(){}});
  const point=(x,y,id=1)=>({button:0,buttons:1,pointerId:id,clientX:x,clientY:y,shiftKey:false});
  events.pointerdown(point(10,10));events.pointermove(point(90,50,2));events.pointerup({pointerId:2});assert.equal(commits.length,0);
  events.pointermove(point(50,30));events.pointerup({pointerId:1});events.pointerup({pointerId:1});await Promise.resolve();assert.equal(commits.length,1);events.pointerdown(point(10,10));assert.equal(captures,1);resolve();await Promise.resolve();await Promise.resolve();assert.equal(commits.length,1);
});

const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('double-click uses native XY reset even for a centered animated wheel and never inserts a zero key',async()=>{
  const events={},commits=[],resets=[],draws=[];let finish;
  const canvas={isConnected:true,addEventListener:(type,handler)=>{events[type]=handler;},getBoundingClientRect:()=>({width:150})};
  bindColorWheel(canvas,{x:0,y:0,paint:(...args)=>draws.push(args),onCommit:(...args)=>commits.push(args),onReset:()=>{resets.push(true);return new Promise(resolve=>{finish=resolve;});},onError(){}});
  events.dblclick();events.dblclick();await settle();assert.equal(resets.length,1);assert.deepEqual(commits,[]);assert.deepEqual(draws.at(-1),[0,0,false]);finish();await settle();
});

test('queued native wheel reset rejects stale ownership and restores coordinates after a known failure',async()=>{
  const events={},draws=[],errors=[];let allowed=true,resets=0;
  const canvas={isConnected:true,addEventListener:(type,handler)=>{events[type]=handler;}};
  bindColorWheel(canvas,{x:.2,y:.1,paint:(...args)=>draws.push(args),onCommit(){assert.fail('reset must not use numeric Apply');},onReset:()=>{resets++;throw Error('Native reset refused');},onError:message=>errors.push(message),canInteract:()=>allowed});
  events.dblclick();allowed=false;await settle();assert.equal(resets,0);assert.deepEqual(draws.at(-1),[.2,.1,false]);
  allowed=true;events.dblclick();await settle();assert.equal(resets,1);assert.deepEqual(errors,['Native reset refused']);assert.deepEqual(draws.at(-1),[.2,.1,false]);
  canvas.isConnected=false;events.dblclick();await settle();assert.equal(resets,1);
});

function selectedWheelHarness(t){
  const globals={document:globalThis.document,Option:globalThis.Option,requestAnimationFrame:globalThis.requestAnimationFrame};
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.isConnected=true;this.value='';this.disabled=false;}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    setAttribute(name,value){this[name]=String(value);}
    reportValidity(){return true;}
    getContext(){return {};}
    focus(){}
  }
  globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};globalThis.requestAnimationFrame=()=>1;
  t.after(()=>{for(const [key,value] of Object.entries(globals))globalThis[key]=value;});
  const wheels=['Shadows','Midtones','Highlights','Offset'].map(name=>({name,x:`${name}X`,y:`${name}Y`,luma:`${name}Luma`,saturation:name==='Offset'?'Saturation':`${name}Sat`}));
  const grade=wheels.flatMap(wheel=>[wheel.x,wheel.y,wheel.luma,wheel.saturation]).concat(['LowRange','HighRange']).map((param,index)=>({param,value:param.endsWith('Sat') || param==='Saturation'?1:0,range:param.endsWith('Sat') || param==='Saturation'?[0,2]:[-1,1],key_count:100,keyframes:[],keyframe_info:{on_keyframe:index===1,previous_frame:index<4?[4,8,12,10][index]:null,next_frame:index<4?[50,40,45,30][index]:null}}));
  const detail={clip_id:'9',video:true,locked:false,color_info:null,filters:{kinds:['ColorCorrection'],grade_presets:[],wheels,wheel_hues:[],stack:[{kind:'ColorCorrection',enabled:true,grade}]}};
  const root=new Element('div'),commands=[],seeks=[],notices=[],selection={project_epoch:'epoch',generation:'1',timeline_id:'timeline',revision:'revision',selection:['2','9'],clip_ids:['9','2']};let allowed=true,frame=20;
  renderSelectedVideoEffects(root,detail,{selection:structuredClone(selection),getSelection:()=>selection,frame,getFrame:()=>frame,canInteract:()=>allowed,canNavigate:()=>allowed,commit:async operation=>{commands.push(operation);},notice:message=>notices.push(message),seek:target=>seeks.push(target),visualState:new Map()});
  const all=(node=root)=>[node,...node.children.flatMap(child=>all(child))],field=label=>all().find(node=>node['aria-label']===label);
  return {root,commands,seeks,notices,selection,detail,all,field,click(label){const node=field(label);assert.ok(node,label);node.dispatchEvent(new Event('click'));},setAllowed:value=>{allowed=value;},setFrame:value=>{frame=value;}};
}

test('selected wheel joint diamond and arrows use all four full-track metadata rows and one selected native operation',async t=>{
  const h=selectedWheelHarness(t),params=['ShadowsX','ShadowsY','ShadowsLuma','ShadowsSat'].map(param=>({kind:'grade',param}));
  assert.equal(h.field('Toggle Shadows wheel keyframes at playhead')['aria-pressed'],'true');
  assert.equal(h.field('Toggle ShadowsX keyframes at playhead'),undefined);
  h.click('Toggle Shadows wheel keyframes at playhead');await settle();h.click('Previous Shadows wheel keyframe');h.click('Next Shadows wheel keyframe');
  assert.deepEqual(h.commands,[{kind:'edit_inspector_selection',clip_ids:['9','2'],timeline_frame:20,edit:{action:'toggle_filter_keys',filter:'ColorCorrection',params}}]);assert.deepEqual(h.seeks,[12,30]);
});

test('wheel group reset uses native four-parameter neutral tracks while double-click resets only XY',async t=>{
  const h=selectedWheelHarness(t),reset=params=>({action:'reset_filter',filter:'ColorCorrection',params:params.map(param=>({kind:'grade',param})),reset_enabled:false,reset_color:false,reset_grade:false});
  h.click('Reset Offset wheel');await settle();
  const canvas=h.field('Shadows color wheel; arrows adjust X/Y');canvas.dispatchEvent(new Event('dblclick'));canvas.dispatchEvent(new Event('dblclick'));await settle();
  assert.deepEqual(h.commands.map(operation=>operation.edit),[reset(['OffsetX','OffsetY','OffsetLuma','Saturation']),reset(['ShadowsX','ShadowsY'])]);
  assert.ok(h.commands.every(operation=>operation.clip_ids.join(',')==='9,2' && operation.timeline_frame===20));
});

test('full ColorCorrection reset contains every native grade parameter exactly once after adding joint wheel rows',async t=>{
  const h=selectedWheelHarness(t);h.click('Reset ColorCorrection filter');await settle();const edit=h.commands[0].edit;
  assert.equal(edit.params.length,18);assert.equal(new Set(edit.params.map(value=>value.param)).size,18);assert.deepEqual(new Set(edit.params.map(value=>value.param)),new Set(h.detail.filters.stack[0].grade.map(value=>value.param)));assert.equal(edit.reset_grade,true);assert.equal(edit.reset_enabled,true);
});

test('new wheel joint controls and reset callbacks reject changed selection, playhead, detached or blocked owners',async t=>{
  const h=selectedWheelHarness(t),canvas=h.field('Shadows color wheel; arrows adjust X/Y');
  canvas.dispatchEvent(new Event('dblclick'));h.selection.generation='new';await settle();assert.deepEqual(h.commands,[]);
  h.selection.generation='1';h.setFrame(21);h.click('Reset Shadows wheel');h.click('Previous Shadows wheel keyframe');h.setFrame(20);
  h.setAllowed(false);h.click('Toggle Shadows wheel keyframes at playhead');canvas.dispatchEvent(new Event('dblclick'));h.setAllowed(true);h.root.isConnected=false;h.click('Reset Offset wheel');await settle();assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
});

test('compact wheels keep luma and saturation beside each wheel and retain exact numeric XY controls in advanced details',async t=>{
  const h=selectedWheelHarness(t),wheels=h.all().filter(node=>node.className==='inspector-wheel');assert.equal(wheels.length,4);
  for(const wheel of h.detail.filters.wheels){
    const canvas=h.field(`${wheel.name} color wheel; arrows adjust X/Y`),block=canvas.parent;
    assert.equal(h.field(wheel.luma).parent.parent.parent,block);assert.equal(h.field(wheel.saturation).parent.parent.parent,block);
    const coordinates=h.field(wheel.x).parent.parent.parent;assert.equal(coordinates.className,'inspector-grade-coordinates');assert.notEqual(coordinates.open,true);
  }
  assert.equal(h.all().filter(node=>node.dataset.inspectorAutoBalance!==undefined).length,1);
  h.click('Auto balance selected video');await settle();assert.deepEqual(h.commands,[]);
  const input=h.field('ShadowsLuma');input.value='.25';input.dispatchEvent(new Event('input'));await settle();assert.deepEqual(h.commands,[]);
  input.dispatchEvent(new Event('change'));await settle();assert.deepEqual(h.commands[0].edit,{action:'filter',filter:'ColorCorrection',patch:{grade:[{param:'ShadowsLuma',value:.25}]}});
});
