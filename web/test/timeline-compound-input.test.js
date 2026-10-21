import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput} from '../js/timeline/input.js';
import {frameToX,RULER,MARKER_TOP} from '../js/timeline/geometry.js';

function harness({commit=async()=>{}}={}){
  const clip={id:'compound',media_id:'nested',kind:'media',start_frame:20,length_frames:100,linked_group:null,fade_in:10,fade_out:10};
  const timeline={id:'t',revision:'r',fps:{num:24,den:1},markers:[{id:'marker',start_frame:20,duration_frames:0}],tracks:[{id:'v',kind:'video',locked:false,clips:[clip],crossings:[]}],transition_defaults:[{kind:'Push',duration:10,direction:'Left',ease:'None',curve:0.5}]};
  const view={origin:0,scale:240,scrollY:0,playhead:777,selection:[],snap:false,tool:'move',retimeVisible:new Set(),transitionSelection:null,draft:null};
  let editable=false,navigable=true,modal=false,intents=0;const opened=[],markers=[],commands=[],handlers=new Map(),captures=new Set(),originalWindow=globalThis.window;
  const document={querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={document,addEventListener(){},removeEventListener(){}};
  const canvas={ownerDocument:document,clientWidth:1600,clientHeight:200,style:{},getBoundingClientRect:()=>({left:12,top:8,width:1600,height:200}),addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),focus(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,getPresetContext:()=>({epoch:'epoch',generation:'0',timeline:'t',revision:'r'}),view,invalidate(){},onSelect(){},onSeek(){},onCommand:operation=>{commands.push(operation);return commit(operation);},onNotice(){},canEdit:()=>editable,canNavigate:()=>navigable,onOpenCompound:ids=>opened.push(ids),onMarkerEdit:id=>markers.push(id),onNavigationIntent:()=>intents++});
  const event=(frame=60,extra={})=>({clientX:12+frameToX(frame,view,timeline.fps),clientY:8+RULER+32,button:0,buttons:1,pointerId:1,preventDefault(){this.prevented=true;},...extra});
  return {timeline,clip,view,input,canvas,opened,markers,commands,handlers,captures,intents:()=>intents,setEditable:value=>editable=value,setNavigable:value=>navigable=value,setModal:value=>modal=value,event,send(type,frame,extra){const e=event(frame,extra);const result=handlers.get(type)(e);return {event:e,result};},destroy(){input.destroy();globalThis.window=originalWindow;}};
}

test('double-click opens the hit compound in read-only mode without moving the current native playhead or selecting clips',()=>{
  const h=harness();try{const {event}=h.send('dblclick',60);assert.deepEqual(h.opened,[['compound']]);assert.equal(event.prevented,true);assert.equal(h.view.playhead,777);assert.deepEqual(h.view.selection,[]);assert.deepEqual(h.commands,[]);assert.equal(h.input.navigationIdle(),true);}finally{h.destroy();}
});

test('double-click marker editing survives compound navigation and clip handles retain their hit clip',()=>{
  const h=harness();try{h.send('dblclick',20,{clientY:8+MARKER_TOP+2});assert.deepEqual(h.markers,['marker']);assert.deepEqual(h.opened,[]);h.send('dblclick',30,{clientY:8+RULER+14});assert.deepEqual(h.opened,[['compound']]);assert.equal(h.view.playhead,777);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('compound double-click refuses modals, prevented events, modifiers, wrong button and unavailable navigation',()=>{
  const h=harness();try{for(const extra of [{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])h.send('dblclick',60,extra);h.setModal(true);h.send('dblclick',60);h.setModal(false);h.setNavigable(false);h.send('dblclick',60);assert.deepEqual(h.opened,[]);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('captured clip gestures block compound opening until release or cancellation',async()=>{
  const h=harness();try{h.send('pointerdown',60);assert.equal(h.input.navigationIdle(),false);assert.equal(h.captures.has(1),true);h.send('dblclick',60);assert.deepEqual(h.opened,[]);await h.send('pointerup',60,{buttons:0}).result;assert.equal(h.input.navigationIdle(),true);h.send('dblclick',60);assert.deepEqual(h.opened,[['compound']]);assert.equal(h.commands.length,0);assert.equal(h.intents(),1);}finally{h.destroy();}
});

test('preset and transition drags block compound opening without losing their own engine ownership',()=>{
  const h=harness();try{h.setEditable(true);const payload=h.input.presetDnd.start({id:'preset',revision:'pr',name:'Look',video:true,audio:false},()=>true);assert.equal(typeof payload,'string');assert.equal(h.input.navigationIdle(),false);h.send('dblclick',60);assert.deepEqual(h.opened,[]);h.input.presetDnd.end();assert.equal(h.input.transitionDnd.start('Push'),true);assert.equal(h.input.navigationIdle(),false);h.send('dblclick',60);assert.deepEqual(h.opened,[]);h.input.transitionDnd.end();h.send('dblclick',60);assert.deepEqual(h.opened,[['compound']]);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});

test('pending native edit release blocks compound opening until its single command settles',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve),h=harness({commit:()=>pending});try{h.setEditable(true);h.send('pointerdown',60);h.send('pointermove',61);const up=h.send('pointerup',61,{buttons:0}).result;assert.equal(h.commands.length,1);assert.equal(h.input.navigationIdle(),false);h.send('dblclick',60);assert.deepEqual(h.opened,[]);release();await up;assert.equal(h.input.navigationIdle(),true);h.send('dblclick',60);assert.deepEqual(h.opened,[['compound']]);assert.equal(h.commands.length,1);}finally{release();h.destroy();}
});

test('viewport and gesture intentions notify navigation cancellation without issuing project commands',()=>{
  const h=harness();try{h.send('wheel',60,{deltaY:4,deltaX:0});h.send('pointerdown',60);assert.equal(h.intents(),2);h.input.cancel();h.handlers.get('keydown')({key:'Escape'});assert.equal(h.intents(),3);assert.equal(h.input.navigationIdle(),true);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
});
