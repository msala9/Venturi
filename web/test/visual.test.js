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

function selectedWheelHarness(t,{shadowColor=null,editDetail=()=>{}}={}){
  const globals={document:globalThis.document,window:globalThis.window,Option:globalThis.Option,requestAnimationFrame:globalThis.requestAnimationFrame},view=new EventTarget();
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.style={};this.isConnected=true;this.value='';this.disabled=false;this.ownerDocument=globalThis.document;this.captured=new Set();}
    get value(){return this.textValue ?? '';}set value(value){this.textValue=String(value);}
    append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(child=>child!==node);node.parent=this;this.children.push(node);}}
    closest(selector){for(let node=this;node;node=node.parent)if(selector==='details:not([open])' && node.tagName==='details' && !node.open)return node;return null;}
    setAttribute(name,value){this[name]=String(value);}
    reportValidity(){return true;}
    getContext(){return null;}
    focus(){}
    setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);const event=new Event('lostpointercapture');Object.defineProperty(event,'pointerId',{value:id});this.dispatchEvent(event);}
  }
  globalThis.document={createElement:tag=>new Element(tag),defaultView:view};globalThis.window=view;globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};globalThis.requestAnimationFrame=()=>1;
  t.after(()=>{for(const control of controls){if(typeof control.dispose==='function')control.dispose();else control.cancel?.();}for(const [key,value] of Object.entries(globals))globalThis[key]=value;});
  const wheels=['Shadows','Midtones','Highlights','Offset'].map(name=>({name,x:`${name}X`,y:`${name}Y`,luma:`${name}Luma`,saturation:name==='Offset'?'Saturation':`${name}Sat`}));
  const grade=wheels.flatMap(wheel=>[wheel.x,wheel.y,wheel.luma,wheel.saturation]).concat(['LowRange','HighRange']).map((param,index)=>({param,value:param==='LowRange'?Math.fround(1/3):param==='HighRange'?Math.fround(2/3):param.endsWith('Sat') || param==='Saturation'?1:0,range:['LowRange','HighRange'].includes(param)?[0,1]:param.endsWith('Sat') || param==='Saturation'?[0,2]:[-1,1],key_count:100,keyframes:[],keyframe_info:{on_keyframe:index===1,previous_frame:index<4?[4,8,12,10][index]:null,next_frame:index<4?[50,40,45,30][index]:null}}));
  const detail={clip_id:'9',video:true,locked:false,color_info:null,filters:{kinds:['ColorCorrection'],grade_presets:[],wheels,wheel_hues:[],stack:[{kind:'ColorCorrection',enabled:true,grade}]}};
  if(shadowColor){detail.filters.kinds.push('DropShadow');detail.filters.blur_radius_max=250;detail.filters.shadow_grow_max=100;detail.filters.stack.push({kind:'DropShadow',enabled:true,radius:{value:2},grow:{value:0},offset:[{value:0},{value:0}],color:{...shadowColor}});}
  editDetail(detail);
  const root=new Element('div'),commands=[],seeks=[],notices=[],selection={project_epoch:'epoch',generation:'1',timeline_id:'timeline',revision:'revision',selection:['2','9'],clip_ids:['9','2']};let allowed=true,frame=20;
  const controls=renderSelectedVideoEffects(root,detail,{selection:structuredClone(selection),getSelection:()=>selection,frame,getFrame:()=>frame,canInteract:()=>allowed,canNavigate:()=>allowed,commit:async operation=>{commands.push(operation);},notice:message=>notices.push(message),seek:target=>seeks.push(target),visualState:new Map(),timelineSize:[1920,1080]});
  const all=(node=root)=>[node,...node.children.flatMap(child=>child && typeof child==='object'?all(child):[])],field=label=>all().find(node=>node['aria-label']===label);
  return {root,commands,seeks,notices,selection,detail,all,field,controls,view,send(node,type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:0,...properties}))Object.defineProperty(event,key,{value});node.dispatchEvent(event);},click(label){const node=field(label);assert.ok(node,label);node.dispatchEvent(new Event('click'));},setAllowed:value=>{allowed=value;},setFrame:value=>{frame=value;}};
}

test('selected DropShadow picker preserves linear alpha and uses selected native patch and reset ownership',async t=>{
  const rgba={r:0.1234567890123,g:0.402391823472,b:0.918273645546,a:0.456789012345};
  const h=selectedWheelHarness(t,{shadowColor:rgba});h.click('Choose DropShadow color');await settle();assert.deepEqual(h.commands,[]);
  const input=h.field('DropShadow color G');input.value=0.3;input.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(h.commands[0],{kind:'edit_inspector_selection',clip_ids:['9','2'],timeline_frame:20,edit:{action:'filter',filter:'DropShadow',patch:{color:{...rgba,g:Math.fround(0.3)}}}});
  h.click('Reset DropShadow color');await settle();assert.deepEqual(h.commands[1].edit,{action:'reset_filter',filter:'DropShadow',params:[],reset_enabled:false,reset_color:true,reset_grade:false});
  h.click('Choose DropShadow color');for(const control of h.controls){control.cancel?.();control.dispose?.();}
  input.value=0.8;input.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
  assert.equal(h.commands.length,2);assert.deepEqual(h.detail.filters.stack[1].color,rgba);
});

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

test('native Color scalar scrubs use .005 travel, Shift precision and supplied per-parameter bounds',async t=>{
  const h=selectedWheelHarness(t),luma=h.field('ShadowsLuma'),sat=h.field('ShadowsSat');
  for(const [input,shiftKey,travel,value] of [[luma,false,20,.1],[sat,true,20,1.01],[luma,false,10000,1],[sat,false,-10000,0]]){
    const count=h.commands.length;h.send(input,'pointerdown');h.send(input,'pointermove',{clientX:travel,shiftKey});assert.equal(h.commands.length,count);
    h.send(input,'pointerup',{pointerId:2,clientX:travel,shiftKey});assert.equal(h.commands.length,count);
    h.send(input,'pointerup',{clientX:travel,shiftKey});await settle();assert.equal(h.commands.length,count+1);assert.equal(h.commands.at(-1).edit.patch.grade[0].value,value);
  }
  assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='9,2' && command.timeline_frame===20 && command.edit.filter==='ColorCorrection' && command.edit.patch.grade.length===1));
});

test('Color scalars follow their actual floating card ancestry and still cancel when their owner becomes hidden',async t=>{
  const h=selectedWheelHarness(t),input=h.field('ShadowsLuma'),filters=h.all().find(node=>node.dataset.visualPath==='selected-filters'),card=h.all().find(node=>node.dataset.visualPath==='selected-filter:ColorCorrection');
  const floating=document.createElement('div');floating.append(card);filters.open=false;
  h.send(input,'pointerdown');h.send(input,'pointermove',{clientX:20});h.send(input,'pointerup',{clientX:20});await settle();
  assert.deepEqual(h.commands[0].edit.patch.grade,[{param:'ShadowsLuma',value:.1}]);
  h.send(input,'pointerdown');h.send(input,'pointermove',{clientX:30});h.setAllowed(false);h.send(input,'pointerup',{clientX:30});await settle();assert.equal(h.commands.length,1);
});

test('native boundary sliders preserve independent Low and High values and use one owned release',async t=>{
  const h=selectedWheelHarness(t),low=h.field('LowRange'),high=h.field('HighRange'),slider=h.field('LowRange slider'),highSlider=h.field('HighRange slider');
  assert.equal(Number(low.value),Math.fround(1/3));assert.equal(Number(high.value),Math.fround(2/3));
  for(const field of [low,high,slider,highSlider]){assert.equal(Number(field.min),0);assert.equal(Number(field.max),1);}assert.equal(slider.step,'any');
  h.send(slider,'pointerdown');slider.value='.9';h.send(slider,'input');assert.equal(Number(low.value),.9);assert.deepEqual(h.commands,[]);
  h.send(slider,'pointerup',{pointerId:2});assert.equal(slider.hasPointerCapture(1),true);assert.deepEqual(h.commands,[]);
  h.send(slider,'pointerup');h.send(slider,'change');h.send(slider,'change');await settle();assert.equal(h.commands.length,1);assert.equal(Number(high.value),Math.fround(2/3));
  h.send(highSlider,'pointerdown');highSlider.value='.1';h.send(highSlider,'pointerup');h.send(highSlider,'change');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit.patch.grade),[[{param:'LowRange',value:.9}],[{param:'HighRange',value:.1}]]);
  assert.equal(Number(low.value),.9);assert.equal(Number(high.value),.1);
});

test('Color scalar and range drafts cancel on Escape, blur and changed ownership without disabling a fresh edit',async t=>{
  const h=selectedWheelHarness(t),number=h.field('LowRange'),slider=h.field('LowRange slider'),initial=number.value;
  for(const cancel of [()=>h.send(slider,'keydown',{key:'Escape'}),()=>h.send(slider,'pointercancel'),()=>h.view.dispatchEvent(new Event('blur')),()=>h.controls.at(-1).cancel(),()=>h.setFrame(21),()=>h.setAllowed(false)]){
    h.setFrame(20);h.setAllowed(true);h.send(slider,'pointerdown');slider.value='.8';h.send(slider,'input');cancel();h.send(slider,'pointerup');h.send(slider,'change');await settle();assert.deepEqual(h.commands,[]);assert.equal(number.value,initial);assert.equal(slider.captured.size,0);
  }
  h.setFrame(20);h.setAllowed(true);h.send(number,'pointerdown');h.send(number,'pointermove',{clientX:20});assert.equal(Number(slider.value),Number(number.value));h.send(number,'keydown',{key:'Escape'});h.send(number,'pointerup',{clientX:20});await settle();assert.equal(number.value,initial);assert.equal(Number(slider.value),Number(initial));assert.deepEqual(h.commands,[]);
  h.send(slider,'pointerdown');slider.value='.75';h.send(slider,'input');h.send(slider,'pointerup');await settle();assert.equal(h.commands.length,1);
});

test('boundary keyboard changes keep precise fields and native keys while disposal makes old gestures inert',async t=>{
  const h=selectedWheelHarness(t),number=h.field('HighRange'),slider=h.field('HighRange slider');
  number.value='.456789123';h.send(number,'input');assert.equal(slider.value,'.456789123');assert.deepEqual(h.commands,[]);h.send(number,'change');await settle();assert.equal(h.commands[0].edit.patch.grade[0].value,.456789123);
  h.send(slider,'keydown',{key:'ArrowRight'});slider.value='.8';h.send(slider,'input');h.send(slider,'change');h.send(slider,'change');await settle();assert.equal(h.commands.length,2);assert.equal(h.commands[1].edit.patch.grade[0].value,.8);
  h.click('Toggle HighRange keyframes at playhead');await settle();assert.deepEqual(h.commands[2].edit,{action:'toggle_filter_keys',filter:'ColorCorrection',params:[{kind:'grade',param:'HighRange'}]});
  h.send(slider,'pointerdown');slider.value='.2';h.send(slider,'input');h.controls.at(-1).dispose();h.send(slider,'pointerup');h.send(slider,'change');h.send(number,'pointerdown');h.send(number,'pointerup',{clientX:30});await settle();assert.equal(h.commands.length,3);assert.equal(Number(number.value),.8);assert.equal(slider.captured.size,0);
});

function nativeScalarFilters(detail){
  detail.filters.kinds.push('Exposure','GaussianBlur');
  detail.filters.stack.push({kind:'Exposure',enabled:true,amount:{value:0},amount_range:[-20,20]},{kind:'GaussianBlur',enabled:true,radius:{value:2},direction:'Both',direction_info:{value:'Both'}});
  detail.filters.blur_directions=['Both','Horizontal','Vertical'];
  const shadow=detail.filters.stack.find(filter=>filter.kind==='DropShadow');shadow.amount={value:80};shadow.amount_range=[0,100];
}

test('non-Color filter scalar controls use native speeds, authoritative limits and selected native patches',async t=>{
  const h=selectedWheelHarness(t,{shadowColor:{r:0,g:0,b:0,a:1},editDetail:nativeScalarFilters});
  for(const [label,travel,shiftKey,filter,patch] of [
    ['Exposure stops',20,false,'Exposure',{amount:.2}],['GaussianBlur radius',10,false,'GaussianBlur',{radius:7}],
    ['DropShadow softness',10,true,'DropShadow',{radius:2.5}],['DropShadow grow',10,false,'DropShadow',{grow:5}],
    ['DropShadow opacity',10,false,'DropShadow',{amount:85}],['DropShadow offset X',10,false,'DropShadow',{offset:[5,0]}],
  ]){
    const input=h.field(label),count=h.commands.length;h.send(input,'pointerdown');h.send(input,'pointermove',{clientX:travel,shiftKey});assert.equal(h.commands.length,count);
    h.send(input,'pointerup',{clientX:travel,shiftKey});await settle();assert.equal(h.commands.length,count+1,label);assert.deepEqual(h.commands.at(-1).edit,{action:'filter',filter,patch},label);
  }
  for(const [label,min,max] of [['Exposure stops',-20,20],['GaussianBlur radius',0,250],['DropShadow softness',0,250],['DropShadow grow',0,100],['DropShadow opacity',0,100]]){
    const slider=h.field(`${label} slider`);assert.ok(slider,label);assert.equal(Number(slider.min),min);assert.equal(Number(slider.max),max);assert.equal(slider.step,'any');
  }
  assert.equal(h.field('DropShadow offset X slider'),undefined);assert.equal(Number(h.field('DropShadow offset X').min),-1920);assert.equal(Number(h.field('DropShadow offset Y').max),1080);
  assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='9,2' && command.timeline_frame===20));assert.equal(h.detail.filters.stack.find(filter=>filter.kind==='Exposure').amount.value,0);
});

test('non-Color filter range drafts cancel on blur, stale context or Escape, then commit one fresh owner release',async t=>{
  const h=selectedWheelHarness(t,{shadowColor:{r:0,g:0,b:0,a:1},editDetail:nativeScalarFilters}),input=h.field('Exposure stops'),slider=h.field('Exposure stops slider');
  for(const cancel of [()=>h.send(slider,'keydown',{key:'Escape'}),()=>h.view.dispatchEvent(new Event('blur')),()=>h.setAllowed(false),()=>h.setFrame(21)]){
    h.setAllowed(true);h.setFrame(20);h.send(slider,'pointerdown');slider.value='1.23456789';h.send(slider,'input');assert.deepEqual(h.commands,[]);cancel();h.send(slider,'pointerup');h.send(slider,'change');await settle();assert.deepEqual(h.commands,[]);assert.equal(Number(input.value),0);assert.equal(slider.captured.size,0);
  }
  h.setAllowed(true);h.setFrame(20);h.send(slider,'pointerdown');slider.value='.23456789';h.send(slider,'input');h.send(slider,'pointerup',{pointerId:2});assert.deepEqual(h.commands,[]);h.send(slider,'pointerup');h.send(slider,'change');h.send(slider,'change');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'filter',filter:'Exposure',patch:{amount:.23456789}}]);
  h.send(slider,'pointerdown');slider.value='2';h.send(slider,'input');h.controls.at(-1).dispose();h.send(slider,'pointerup');h.send(slider,'change');await settle();assert.equal(h.commands.length,1);assert.equal(Number(input.value),.23456789);assert.equal(slider.captured.size,0);
});
