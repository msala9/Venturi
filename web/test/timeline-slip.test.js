import test from 'node:test';
import assert from 'node:assert/strict';
import {slipPointerDelta,slipMediaExtents,frameToX,timelineLayout} from '../js/timeline/geometry.js';
import {createInput} from '../js/timeline/input.js';
import {createDraw} from '../js/timeline/draw.js';

test('native Slip pointer direction rounds ties away and clamps asymmetric handles after reversing the drag',()=>{
  const view={scale:240},fps={num:24,den:1};
  for(const [pixels,expected] of [[15,-2],[-15,2],[5,-1],[-5,1],[100,-3],[-100,7],[0,0]])assert.equal(slipPointerDelta(pixels,view,fps,-3,7),expected);
  assert.throws(()=>slipPointerDelta(1,view,fps,3,-1),/bounds/);
});
test('fractional Slip pointer conversion uses native f32 pixels per frame and frame-half rounding',()=>{
  const fps={num:30000,den:1001},view={scale:Math.fround(fps.num/fps.den)*4},ppf=4;
  for(const sign of [-1,1]){
    assert.equal(slipPointerDelta(Math.fround(ppf*1.5)*sign,view,fps,-20,20),-2*sign);
    assert.equal(slipPointerDelta(Math.fround(ppf*2.25)*sign,view,fps,-20,20),-2*sign);
  }
  assert.equal(slipPointerDelta(1000,view,fps,-4,9),-4);
  assert.equal(slipPointerDelta(-1000,view,fps,-4,9),9);
});

function harness(){
  const previous=globalThis.window,handlers=new Map(),captures=new Set(),commands=[],drafts=[];
  let modal=false,writable=true;
  const doc={hidden:false,querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={devicePixelRatio:1,document:doc,addEventListener(){},removeEventListener(){}};
  const clip={id:'9007199254740993',kind:'media',start_frame:20,length_frames:100,linked_group:'pair',fade_in:0,fade_out:0,slip_range:[-3,9]},peer={...clip,id:'9007199254740995',slip_range:[-7,7]};
  const timeline={id:'t',revision:'r',fps:{num:24,den:1},tracks:[{id:'v',kind:'video',clips:[clip]},{id:'a',kind:'audio',clips:[peer]}]},view={scale:240,origin:0,viewportHeight:220,selection:[],selectionAnchor:null,snap:false,playhead:30,tool:'slip',draft:null,lasso:null};
  const canvas={ownerDocument:doc,clientWidth:1200,clientHeight:220,style:{},getBoundingClientRect:()=>({left:0,top:0,width:1200,height:220}),focus(){},addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,getGapContext:()=>({project_epoch:'epoch',generation:'0'}),view,invalidate(){},onSelect(){},onSeek(){},onCommand:async operation=>commands.push(operation),onNotice(){},onSlip:entry=>drafts.push(entry),canEdit:()=>writable});
  const x=frameToX(40,view,timeline.fps),y=timelineLayout(timeline,view).trackTop(0)+30;
  const send=(name,dx=0,extra={})=>handlers.get(name)({pointerId:1,button:0,buttons:1,clientX:x+dx,clientY:y,preventDefault(){},...extra});
  return {input,view,timeline,clip,peer,commands,drafts,captures,handlers,doc,send,setModal:value=>modal=value,setWritable:value=>writable=value,destroy(){input.destroy();globalThis.window=previous;}};
}
test('Slip controller previews earlier media to the right, commits one linked delta at release and leaves native geometry unchanged',async()=>{
  for(const [pixels,expected] of [[25,-3],[-25,3],[-150,7]]){const h=harness();try{
    const before=JSON.stringify(h.timeline);h.send('pointerdown');h.send('pointermove',pixels);assert.equal(h.view.draft.target,expected);assert.deepEqual(h.commands,[]);assert.equal(h.drafts.at(-1).delta,expected);
    await h.send('pointerup',pixels,{buttons:0});assert.deepEqual(h.commands,[{kind:'slip',clip_ids:[h.clip.id,h.peer.id],delta_frames:expected}]);assert.equal(h.captures.size,0);assert.equal(JSON.stringify(h.timeline),before);assert.equal(h.drafts.at(-1).phase,'end');
  }finally{h.destroy();}}
});
test('Slip release without an intermediate move uses the same native sign and cancellation never dispatches',async()=>{
  const h=harness();try{h.send('pointerdown');await h.send('pointerup',-25,{buttons:0});assert.equal(h.commands[0].delta_frames,3);}finally{h.destroy();}
  for(const change of ['escape','modal','revision','scale','readonly','capture']){const h=harness();try{
    h.send('pointerdown');h.send('pointermove',20);
    if(change==='escape')h.handlers.get('keydown')({key:'Escape'});if(change==='modal')h.setModal(true);if(change==='revision')h.timeline.revision='next';if(change==='scale')h.view.scale=100;if(change==='readonly')h.setWritable(false);if(change==='capture')h.handlers.get('pointercancel')({pointerId:1});
    await h.send('pointerup',25,{buttons:0});assert.deepEqual(h.commands,[],change);assert.equal(h.view.draft,null,change);assert.equal(h.captures.size,0,change);
  }finally{h.destroy();}}
});
test('linked Slip extents use each native handle range and shifted timeline edges without changing source clocks',()=>{
  const h=harness();try{
    h.send('pointerdown');h.send('pointermove',20);const before=JSON.stringify(h.timeline),extents=slipMediaExtents(h.timeline,h.view);
    assert.deepEqual(extents.map(item=>[item.clip_id,item.start_frame,item.end_frame]),[[h.clip.id,19,131],[h.peer.id,15,129]]);
    for(const extent of extents){const index=h.timeline.tracks.findIndex(track=>track.id===extent.track_id),top=timelineLayout(h.timeline,h.view).trackTop(index);assert.equal(extent.top,top+1);assert.equal(extent.bottom,top+61);assert.equal(extent.left,frameToX(extent.start_frame,h.view,h.timeline.fps));}
    assert.equal(JSON.stringify(h.timeline),before);h.view.draft=null;assert.deepEqual(slipMediaExtents(h.timeline,h.view),[]);
  }finally{h.destroy();}
});
test('draw paints both linked native extents inside existing pane clipping and removes them when the gesture ends',()=>{
  const h=harness(),previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,ResizeObserver:globalThis.ResizeObserver},frames=[],calls=[];let draw;
  try{
    globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:name=>name});globalThis.devicePixelRatio=1;globalThis.requestAnimationFrame=fn=>frames.push(fn);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
    const context=new Proxy({},{get:(_,method)=>(...args)=>calls.push({method,args})}),canvas={clientWidth:1200,clientHeight:220,getContext:()=>context};
    h.send('pointerdown');h.send('pointermove',20);const extents=slipMediaExtents(h.timeline,h.view);draw=createDraw(canvas,()=>h.timeline,h.view);frames.shift()();
    for(const extent of extents)assert.ok(calls.some(call=>call.method==='strokeRect' && JSON.stringify(call.args)===JSON.stringify([extent.left,extent.top,extent.right-extent.left,extent.bottom-extent.top])));
    assert.ok(calls.filter(call=>call.method==='clip').length>=2);assert.deepEqual(h.commands,[]);
    calls.length=0;h.input.cancel();draw.invalidate();frames.shift()();for(const extent of extents)assert.ok(!calls.some(call=>call.method==='strokeRect' && JSON.stringify(call.args)===JSON.stringify([extent.left,extent.top,extent.right-extent.left,extent.bottom-extent.top])));
  }finally{draw?.destroy();Object.assign(globalThis,previous);h.destroy();}
});
