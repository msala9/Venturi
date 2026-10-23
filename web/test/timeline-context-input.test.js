import test from 'node:test';
import assert from 'node:assert/strict';
import {createInput,isTimelineContextShortcut} from '../js/timeline/input.js';
import {frameToX,timelineLayout,RULER} from '../js/timeline/geometry.js';

function fixture(){
  const previous=globalThis.window,handlers=new Map(),captures=new Set(),menus=[],commands=[],seeks=[];
  let context={project_epoch:'epoch',generation:'1'},navigable=true,editable=true,modal=false,nav=()=>{};
  const clip=(id,start)=>({id,kind:'media',start_frame:start,length_frames:20,linked_group:null,fade_in:0,fade_out:0});
  const timeline={id:'1',revision:'r1',fps:{num:24,den:1},markers:[{id:'m0',start_frame:40,duration_frames:0,note:'Point'}],tracks:[
    {id:'v1',kind:'video',locked:false,clips:[clip('10',30),clip('11',70)],crossings:[]},
    {id:'a1',kind:'audio',locked:false,clips:[clip('12',30)],crossings:[]},
    {id:'v2',kind:'video',locked:true,clips:[clip('13',30)],crossings:[]},
  ]};
  const view={origin:0,scale:120,playhead:17,selection:['11'],selectionAnchor:{project_epoch:'epoch',timeline_id:'1',track_id:'v1',clip_id:'11'},snap:false,tool:'move',retimeVisible:new Set()};
  const document={hidden:false,querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={document,devicePixelRatio:1.25,addEventListener(){},removeEventListener(){}};
  const canvas={ownerDocument:document,clientWidth:900,clientHeight:400,style:{},getBoundingClientRect:()=>({left:10,top:20,width:1125,height:500}),focus(){},addEventListener:(type,handler)=>handlers.set(type,handler),removeEventListener:type=>handlers.delete(type),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
  const input=createInput({canvas,getTimeline:()=>timeline,getGapContext:()=>context,view,invalidate(){},onSelect(){},onSeek:()=>seeks.push(view.playhead),onCommand:operation=>commands.push(operation),onNotice(){},canNavigate:()=>navigable,canEdit:()=>editable,onNavigationIntent:()=>nav(),onContextMenu:target=>{menus.push(target);return true;}});
  const event=(frame,track=0,extra={})=>({button:2,pointerId:1,buttons:2,clientX:10+frameToX(frame,view,timeline.fps)*1.25,clientY:20+(timelineLayout(timeline,view).trackTop(track)+32)*1.25,preventDefault(){this.prevented=true;},stopPropagation(){},...extra});
  return {input,canvas,view,timeline,document,handlers,captures,menus,commands,seeks,event,send(type,frame,track=0,extra={}){const value=event(frame,track,extra);handlers.get(type)(value);return value;},key(extra={}){const value={key:'F10',shiftKey:true,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};handlers.get('keydown')(value);return value;},setEditable:value=>editable=value,setNavigable:value=>navigable=value,setModal:value=>modal=value,setNav:callback=>nav=callback,setGeneration:value=>context={...context,generation:value},destroy(){input.destroy();globalThis.window=previous;}};
}

test('secondary opening targets the pointer clip through CSS scaling without selecting, seeking or capturing',()=>{
  const h=fixture();try{
    const before=structuredClone(h.view),event=h.send('pointerdown',35);assert.equal(h.captures.size,0);assert.equal(event.prevented,undefined);
    const opened=h.send('contextmenu',35);assert.equal(opened.prevented,true);assert.equal(h.menus.length,1);
    assert.deepEqual(h.menus[0],{kind:'clip',clip_id:'10',track_id:'v1',frame:35,clientX:opened.clientX,clientY:opened.clientY,returnFocus:h.canvas});
    assert.deepEqual(h.view.selection,before.selection);assert.deepEqual(h.view.selectionAnchor,before.selectionAnchor);assert.equal(h.view.playhead,before.playhead);
    assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);assert.equal(h.captures.size,0);
  }finally{h.destroy();}
});

test('ruler, header flags, blank pane and marker retain separate context targets and preserve the playhead',()=>{
  const h=fixture();try{
    h.send('contextmenu',60,0,{clientY:20+10*1.25});assert.equal(h.menus.at(-1).kind,'ruler');assert.equal(h.menus.at(-1).frame,60);
    const y=20+(timelineLayout(h.timeline,h.view).trackTop(0)+31)*1.25;
    h.send('contextmenu',0,0,{clientX:10+45*1.25,clientY:y});assert.equal(h.menus.at(-1).kind,'track');assert.equal(h.menus.at(-1).track_id,'v1');
    h.send('contextmenu',110);assert.equal(h.menus.at(-1).kind,'background');assert.equal(h.menus.at(-1).track_id,'v1');
    h.send('contextmenu',40,0,{clientY:20+33*1.25});assert.equal(h.menus.at(-1).kind,'marker');assert.equal(h.menus.at(-1).marker_id,'m0');
    h.send('contextmenu',0,0,{clientX:20,clientY:20+(RULER+5)*1.25});assert.equal(h.menus.at(-1).kind,'background');assert.equal(h.menus.at(-1).pane,'video');
    assert.equal(h.view.playhead,17);assert.deepEqual(h.view.selection,['11']);assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
  }finally{h.destroy();}
});

test('general keyboard context uses the selected anchor without visible speed strips and opens readonly targets',()=>{
  const h=fixture();try{
    h.view.selection=['10','11'];assert.equal(h.key().prevented,true);assert.equal(h.menus.at(-1).clip_id,'11');
    h.setEditable(false);h.key({key:'ContextMenu',shiftKey:false});assert.equal(h.menus.length,2);assert.equal(h.menus.at(-1).clip_id,'11');
    h.send('contextmenu',35,2);assert.equal(h.menus.at(-1).clip_id,'13');
    const target=h.menus[0];assert.ok(target.clientX>=10 && target.clientX<=1135);assert.ok(target.clientY>=20 && target.clientY<=520);
    h.view.selection=[];h.view.selectionAnchor=null;h.key();assert.equal(h.menus.at(-1).kind,'ruler');assert.equal(h.menus.at(-1).frame,17);
    assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
  }finally{h.destroy();}
});

test('menu opening refuses modal, hidden, unavailable, active gesture and changed native ownership',()=>{
  for(const blocked of ['modal','hidden','navigation','gesture','generation']){
    const h=fixture();try{
      if(blocked==='modal')h.setModal(true);if(blocked==='hidden')h.document.hidden=true;if(blocked==='navigation')h.setNavigable(false);
      if(blocked==='gesture')h.send('pointerdown',35,0,{button:0,buttons:1});if(blocked==='generation'){let generation=1;h.setNav(()=>h.setGeneration(String(++generation)));}
      h.send('contextmenu',35);h.key();assert.deepEqual(h.menus,[],blocked);assert.deepEqual(h.commands,[],blocked);
    }finally{h.destroy();}
  }
});

test('keyboard guard rejects text, IME, repeat and modified context keys; destroy removes the secondary handler',()=>{
  const h=fixture();try{
    for(const extra of [{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{target:{closest:()=>({})}},{getModifierState:()=>true},{defaultPrevented:true},{shiftKey:false},{key:'ContextMenu',shiftKey:true}]){const event={key:'F10',shiftKey:true,...extra};assert.equal(isTimelineContextShortcut(event),false);h.key(extra);}
    assert.deepEqual(h.menus,[]);assert.equal(h.input.openContextMenu({kind:'clip',clip_id:'missing',track_id:'v1'}),false);
    assert.equal(h.input.openContextMenu({kind:'track',track_id:'missing'}),false);assert.equal(h.input.openContextMenu({kind:'marker',marker_id:'missing'}),false);
  }finally{h.destroy();}
  assert.equal(h.handlers.has('contextmenu'),false);
});
