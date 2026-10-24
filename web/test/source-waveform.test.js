import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceWaveform,sourceWaveformLayout,sourceWaveformFrameAt,sourceWaveformPeak} from '../js/source-waveform.js';
import {sourceAssetKey} from '../js/source-assets.js';

test('128 native stream lanes remain scrollable with 44 px minimum height and 6 px gaps',()=>{
  const first=sourceWaveformLayout(128,600,120,0);assert.equal(first.contentHeight,6394);assert.equal(first.laneHeight,44);assert.deepEqual(first.lanes.map(lane=>lane.index),[0,1,2]);
  const last=sourceWaveformLayout(128,600,300,99999);assert.equal(last.scroll,6094);assert.equal(last.lanes.at(-1).index,127);assert.ok(last.lanes.every(lane=>lane.top<300 && lane.top+lane.height>0));
  const stretched=sourceWaveformLayout(2,600,200);assert.equal(stretched.laneHeight,97);assert.equal(stretched.lanes[1].top,103);
  assert.equal(sourceWaveformLayout(129,600,200),null);assert.equal(sourceWaveformLayout(1,0,200),null);
});

test('native columns sample the absolute audio-duration bin at 0 dB and clicks floor to a bounded source frame',()=>{
  const waveform={peaks:[.1,.9,.2,.8],duration_seconds:10};
  assert.equal(sourceWaveformPeak(waveform,100,{num:10,den:1},0,2),.1);
  assert.equal(sourceWaveformPeak(waveform,100,{num:10,den:1},1,2),.2,'a dense column samples its native bin, not the largest nearby peak');
  assert.equal(sourceWaveformPeak({...waveform,duration_seconds:5},100,{num:10,den:1},1,2),.8,'each stream uses its own native audio duration');
  assert.equal(sourceWaveformPeak({...waveform,duration_seconds:1000*1001/30000},1000,{num:30000,den:1001},50,100),.2);
  for(const [x,expected] of [[0,0],[100,0],[200,25],[300,49],[999,49]])assert.equal(sourceWaveformFrameAt(x,100,200,50),expected);
  assert.equal(sourceWaveformFrameAt(300,100,200,1),0);assert.equal(sourceWaveformFrameAt(1,0,0,50),null);
});

class Node {
  constructor(document){this.ownerDocument=document;this.listeners=new Map();this.attributes=new Map();this.style={};this.dataset={};this.hidden=false;this.isConnected=true;this.scrollTop=0;this.clientWidth=200;this.clientHeight=100;this.area={left:100,top:20,width:200,height:100};}
  addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);}
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  emit(type,values={}){const event={type,target:this,button:0,pointerId:1,clientX:150,clientY:60,buttons:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const callback of this.listeners.get(type) || [])callback(event);return event;}
  setAttribute(name,value){this.attributes.set(name,value);}
  getAttribute(name){return this.attributes.get(name) ?? null;}
  getBoundingClientRect(){return {...this.area};}
  focus(){this.ownerDocument.activeElement=this;}
}
function harness({count=1,width=200,height=100,playing=false,verified=true,sourceVersion='fd:one',dpr=1}={}){
  const document=new Node(null);document.ownerDocument=document;document.hidden=false;document.modal=false;document.querySelector=()=>document.modal?{}:null;
  const window=new Node(document);document.defaultView=window;window.devicePixelRatio=dpr;
  const observers=[];class Observer {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const root=new Node(document),canvas=new Node(document),content=new Node(document);root.clientWidth=width;root.clientHeight=height;root.area.width=width;root.area.height=height;
  const strokes=[],rects=[],texts=[],transforms=[];let path=[];
  const ctx={setTransform(...args){transforms.push(args);},clearRect(){strokes.length=0;rects.length=0;texts.length=0;},fillRect(...args){rects.push({args,color:this.fillStyle});},beginPath(){path=[];},moveTo(...args){path.push(['M',...args]);},lineTo(...args){path.push(['L',...args]);},stroke(){strokes.push({path:[...path],width:this.lineWidth,color:this.strokeStyle});},fillText(...args){texts.push(args);}};
  canvas.getContext=()=>ctx;
  const item={id:'audio',content_hash:'native-hash',duration_frames:40,fps:{num:10,den:1},audio_stream_count:count,has_video:false,has_audio:true};
  let context={item,epoch:'epoch',sourceVersion,frame:10,marks:{source_in:10,source_out:30},preparing:false,verified,playing};
  const assets=new Map(),demands=[],seeks=[],errors=[],frames=new Map();let sequence=0;
  const addAsset=(index,version='fd:one',waveform={scope:'full_source',duration_seconds:4,peaks:[0,.5,1,.25]})=>assets.set(sourceAssetKey(item.id,index),{mediaId:item.id,contentHash:item.content_hash,sourceVersion:version,waveform});
  const component=createSourceWaveform({root,canvas,content,getContext:()=>context,getAssets:()=>assets,onDemand:(entries,epoch)=>demands.push({entries,epoch}),onSeek:frame=>seeks.push(frame),onError:error=>errors.push(error),requestFrame:callback=>{const id=++sequence;frames.set(id,callback);return id;},cancelFrame:id=>frames.delete(id),resizeObserver:Observer,devicePixelRatio:()=>window.devicePixelRatio});
  const paint=()=>{const batch=[...frames.values()];frames.clear();for(const callback of batch)callback();};
  return {component,root,canvas,content,document,window,observers,strokes,rects,texts,transforms,item,assets,addAsset,demands,seeks,errors,frames,paint,get context(){return context;},set context(value){context=value;},refresh(){component.refresh();paint();}};
}

test('paint uses separate stream lanes, native minimum peak height, range shading and one absolute 2 px playhead',()=>{
  const h=harness({count:2,width:4,height:100,dpr:2});try{
    h.addAsset(0);h.addAsset(1);h.paint();assert.equal(h.strokes.length,3);assert.equal(h.strokes[0].width,1);
    assert.deepEqual(h.strokes[0].path.slice(0,4),[['M',0,23],['L',0,24],['M',1,11.75],['L',1,35.25]]);
    assert.deepEqual(h.strokes[2].path,[['M',1,0],['L',1,100]]);assert.equal(h.strokes[2].width,2);
    assert.deepEqual(h.rects.slice(-2).map(rect=>rect.args),[[0,0,1,100],[3,0,1,100]]);assert.match(h.rects.at(-1).color,/0\.54902/);
    assert.equal(h.canvas.width,8);assert.equal(h.canvas.height,200);assert.equal(h.root.getAttribute('aria-busy'),'false');assert.match(h.root.getAttribute('aria-label'),/2 streams/);
  }finally{h.component.dispose();}
});

test('visible-stream demand reaches the last of 128 streams without per-frame publications or enlarged caches',()=>{
  const h=harness({count:128,height:120});try{
    h.paint();assert.deepEqual(h.demands.at(-1).entries.map(entry=>entry.audioStreamIndex),[0,1,2]);assert.equal(h.root.getAttribute('aria-busy'),'true');assert.equal(h.root.dataset.loadedStreams,'0');assert.equal(h.root.dataset.visibleStreams,'3');assert.match(h.root.getAttribute('aria-label'),/Analyzing/);
    assert.ok(h.demands.at(-1).entries.every(entry=>entry.includeWaveform && entry.sourceVersion==='fd:one' && entry.item===h.item));assert.equal(h.demands.at(-1).epoch,'epoch');
    const count=h.demands.length;h.context.frame=11;h.refresh();assert.equal(h.demands.length,count);
    h.root.scrollTop=99999;h.root.emit('scroll');h.paint();assert.equal(h.demands.at(-1).entries.at(-1).audioStreamIndex,127);assert.ok(h.demands.at(-1).entries.length<=64);assert.equal(h.content.style.height,'6394px');
    h.context=null;h.component.refresh();assert.equal(h.root.hidden,true);assert.deepEqual(h.demands.at(-1).entries,[]);assert.equal(h.frames.size,0);
  }finally{h.component.dispose();}
});

test('cached peaks require verified opaque FD identity and survive preparation only for that same previously verified source',()=>{
  const h=harness({verified:false,sourceVersion:null});try{
    h.addAsset(0);h.paint();assert.equal(h.strokes.length,1);assert.match(h.texts[0][0],/verified/);assert.deepEqual(h.demands.at(-1).entries,[]);
    h.context.sourceVersion='fd:one';h.context.verified=true;h.refresh();assert.equal(h.strokes.length,2);assert.equal(h.demands.at(-1).entries.length,1);
    h.context.preparing=true;h.context.verified=false;h.refresh();assert.equal(h.strokes.length,2);assert.equal(h.root.dataset.state,'preparing');assert.equal(h.root.getAttribute('aria-busy'),'true');assert.deepEqual(h.demands.at(-1).entries,[]);assert.match(h.texts.at(-1)[0],/Preparing source/);
    h.context.sourceVersion='fd:two';h.refresh();assert.equal(h.strokes.length,1);assert.match(h.texts[0][0],/Preparing/);
    h.context.preparing=false;h.context.verified=true;h.refresh();assert.equal(h.strokes.length,1,'old cached source bytes are never displayed under a new version');
    h.addAsset(0,'fd:two');h.refresh();assert.equal(h.strokes.length,2);
    h.context.item={...h.item,content_hash:'changed'};h.refresh();assert.equal(h.strokes.length,1);
  }finally{h.component.dispose();}
});

test('Library audio lanes demand their native Source descriptor and never display another revision under matching cache IDs',()=>{
  const h=harness({count:2});
  try{
    h.item.native_asset={id:'library-audio',revision:'a'.repeat(64),if_generation:'3',source_version:'fd:one'};
    h.addAsset(0);h.addAsset(1);
    for(const asset of h.assets.values()){asset.epoch='epoch';asset.nativeAsset={...h.item.native_asset};}
    h.refresh();assert.equal(h.root.dataset.loadedStreams,'2');assert.equal(h.root.dataset.state,'ready');
    assert.deepEqual(h.demands.at(-1).entries.map(entry=>entry.audioStreamIndex),[0,1]);
    assert(h.demands.at(-1).entries.every(entry=>entry.item.native_asset.id==='library-audio' && entry.item.native_asset.if_generation==='3' && entry.sourceVersion==='fd:one'));
    h.assets.get(sourceAssetKey(h.item.id,1)).epoch='other-epoch';h.refresh();assert.equal(h.root.dataset.loadedStreams,'1');
    h.assets.get(sourceAssetKey(h.item.id,1)).epoch='epoch';h.assets.get(sourceAssetKey(h.item.id,1)).nativeAsset.revision='b'.repeat(64);h.refresh();assert.equal(h.root.dataset.loadedStreams,'1');
    h.item.native_asset={...h.item.native_asset,source_version:'fd:two'};h.context.sourceVersion='fd:two';h.refresh();assert.equal(h.root.dataset.loadedStreams,'0');
    h.context.sourceVersion='fd:one';h.refresh();assert.equal(h.root.hidden,true,'mismatched verified Source and native descriptor cannot retain an old waveform');assert.deepEqual(h.demands.at(-1).entries,[]);
  }finally{h.component.dispose();}
});

test('a waveform seeks on click release while real HTML5 Source All drag and changed owners never seek',()=>{
  const h=harness();try{
    h.paint();const down=h.root.emit('pointerdown');assert.equal(down.defaultPrevented,undefined);assert.deepEqual(h.seeks,[]);
    h.context.frame=11;h.refresh();h.window.emit('pointerup');assert.deepEqual(h.seeks,[10],'natural playback clock advancement does not cancel a click');
    h.root.emit('pointerdown',{clientX:300});h.window.emit('pointerup',{clientX:300});assert.equal(h.seeks.at(-1),39);
    h.root.emit('pointerdown');const drag=h.root.emit('dragstart');h.window.emit('pointerup');assert.equal(drag.defaultPrevented,undefined);assert.equal(h.seeks.length,2);
  }finally{h.component.dispose();}
  for(const change of [h=>h.window.emit('pointermove',{clientX:157}),h=>h.window.emit('blur'),h=>h.document.modal=true,h=>h.context.sourceVersion='new',h=>h.root.emit('scroll'),h=>h.root.area.width++,h=>h.context.preparing=true,h=>h.document.hidden=true,h=>h.window.emit('pointercancel'),h=>h.context.marks.source_in++,h=>h.component.dispose()]){
    const h=harness();try{h.paint();h.root.emit('pointerdown');change(h);h.window.emit('pointerup');assert.deepEqual(h.seeks,[]);}finally{h.component.dispose();}
  }
});

test('temporary invalid Source marks keep audio visible and click seeking available without an insertion command',()=>{
  for(const marks of [null,{source_in:NaN,source_out:30},{source_in:10,source_out:''},{source_in:30,source_out:10},{source_in:0,source_out:99}]){
    const h=harness();try{
      h.context.marks=marks;h.addAsset(0);h.paint();assert.equal(h.root.hidden,false);assert.equal(h.strokes.length,2);assert.deepEqual(h.rects.slice(-2).map(rect=>rect.args),[[0,0,0,100],[200,0,0,100]]);
      h.root.emit('pointerdown');h.window.emit('pointerup');assert.deepEqual(h.seeks,[10]);assert.deepEqual(h.errors,[]);
    }finally{h.component.dispose();}
  }
});

test('focused waveform keys seek locally without intercepting text, modifiers, composition or unrelated keyboard owners',()=>{
  const h=harness();try{
    h.paint();for(const [key,frame] of [['ArrowLeft',9],['ArrowRight',11],['Home',0],['End',39]]){const event=h.root.emit('keydown',{key});assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(h.seeks.at(-1),frame);}
    const count=h.seeks.length;for(const extra of [{target:{}},{target:{closest:()=>true}},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true},{getModifierState:()=>true}])h.root.emit('keydown',{key:'ArrowRight',...extra});assert.equal(h.seeks.length,count);
    h.root.emit('pointerdown');h.root.emit('keydown',{key:'Escape'});h.window.emit('pointerup');assert.equal(h.seeks.length,count);
  }finally{h.component.dispose();}
});

test('one RAF follows verified playback, stops on pause or hidden state, and canvas allocation stays below 16 MiB',()=>{
  const h=harness({playing:true,width:4000,height:3000,dpr:4});try{
    h.paint();assert.equal(h.frames.size,1);assert.ok(h.canvas.width*h.canvas.height*4<=16*1024*1024);const demands=h.demands.length;
    h.context.frame=12;h.paint();assert.equal(h.frames.size,1);assert.equal(h.demands.length,demands);
    h.context.playing=false;h.component.refresh();h.paint();assert.equal(h.frames.size,0);
    h.context.playing=true;h.component.refresh();h.paint();assert.equal(h.frames.size,1);
    h.document.hidden=true;h.document.emit('visibilitychange');assert.equal(h.frames.size,0);assert.deepEqual(h.demands.at(-1).entries,[]);
    h.document.hidden=false;h.document.emit('visibilitychange');h.paint();assert.equal(h.frames.size,1);
  }finally{h.component.dispose();}
  assert.equal(h.frames.size,0);assert.equal(h.canvas.width,1);assert.equal(h.canvas.height,1);assert.deepEqual(h.demands.at(-1).entries,[]);assert.ok(h.observers.every(observer=>observer.disconnected));assert.ok([...h.window.listeners.values()].every(listeners=>listeners.size===0));
});
