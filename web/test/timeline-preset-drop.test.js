import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInput,TRANSITION_DRAG_TYPE} from '../js/timeline/input.js';
import {PRESET_DRAG_TYPE,presetApplication} from '../js/timeline/preset-drop.js';
import {createDraw} from '../js/timeline/draw.js';
import {HEADER,RULER,TRACK,frameToX,timelineLayout} from '../js/timeline/geometry.js';

function harness({linked=false,commit}={}){
  const clip=(id,start_frame,length_frames,linked_group=null)=>({id,kind:'media',start_frame,length_frames,linked_group,fade_in:10,fade_out:10});
  const a=clip('9007199254740993',20,60,linked?'42':null),b=clip('9007199254740995',100,40),audio=clip('9007199254740997',20,60,linked?'42':null);
  let timeline={id:'9007199254741001',revision:'timeline-r1',fps:{num:24000,den:1001},tracks:[{id:'v1',kind:'video',locked:false,clips:[a,b]},{id:'a1',kind:'audio',locked:false,clips:[audio]}],transition_defaults:[{kind:'Push',duration:10,direction:'Left',ease:'None',curve:0.5}]};
  const view={scale:240,origin:0,scrollY:0,selection:[b.id],tool:'select',snap:true,playhead:0,transitionSelection:null,retimeVisible:new Set()};
  let rect={left:12.5,top:8.25,width:1875,height:275},writable=true,modal=false,sourceValid=true,context={epoch:'project:1',generation:'0',timeline:timeline.id,revision:timeline.revision},selections=0;
  const priorWindow=globalThis.window,handlers=new Map(),windowHandlers=new Map(),documentHandlers=new Map(),commands=[],notices=[],captures=new Set();
  const document={hidden:false,querySelector:()=>modal?{}:null,addEventListener:(key,fn)=>documentHandlers.set(key,fn),removeEventListener:key=>documentHandlers.delete(key)};
  globalThis.window={document,addEventListener:(key,fn)=>windowHandlers.set(key,fn),removeEventListener:key=>windowHandlers.delete(key)};
  const canvas={clientWidth:1500,clientHeight:220,style:{},ownerDocument:document,focus(){},getBoundingClientRect:()=>({...rect}),addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>timeline,getPresetContext:()=>({...context,clip_ids:[...view.selection],roles:{video:true,audio:true}}),view,invalidate(){},onSelect:()=>selections++,onSeek(){},onCommand:async command=>{commands.push(command);return commit?.(command);},onNotice:message=>notices.push(message),canEdit:()=>writable});
  let item={id:'preset_9007199254740999',revision:'preset-r1',name:'Native look <literal>',video:true,audio:false};
  const current=snapshot=>sourceValid && item.id===snapshot.id && item.revision===snapshot.revision && item.name===snapshot.name && item.video===snapshot.video && item.audio===snapshot.audio;
  const event=(frame,{track=0,y=timelineLayout(timeline,view,canvas.clientHeight).trackTop(track)+30,x=frameToX(frame,view,timeline.fps),...extra}={})=>({clientX:rect.left+x*rect.width/canvas.clientWidth,clientY:rect.top+y*rect.height/canvas.clientHeight,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
  const transfer=(payload,types=[PRESET_DRAG_TYPE])=>({types,dropEffect:'none',getData(type){assert.equal(type,PRESET_DRAG_TYPE);return payload;}});
  const start=()=>input.presetDnd.start(item,current);
  const over=(payload,frame=30,extra={})=>{const e=event(frame,{dataTransfer:transfer(payload),...extra});handlers.get('dragover')(e);return e;};
  const drop=(payload,frame=30,extra={})=>handlers.get('drop')(event(frame,{dataTransfer:transfer(payload),...extra}));
  return {a,b,audio,view,canvas,input,handlers,windowHandlers,documentHandlers,document,commands,notices,event,transfer,start,over,drop,current,item:()=>item,setItem:value=>item=value,timeline:()=>timeline,context:()=>context,selections:()=>selections,setSourceValid:value=>sourceValid=value,setWritable:value=>writable=value,setModal:value=>modal=value,replaceTimeline(){timeline={...timeline};},changeRect(){rect={...rect,left:rect.left+1};},destroy(){input.destroy();globalThis.window=priorWindow;}};
}

test('preset drop uses fractional FPS and transformed CSS coordinates without changing unselected targets or opaque IDs',async()=>{
  const h=harness();
  try{
    const selection=[...h.view.selection],payload=h.start();assert.equal(typeof payload,'string');assert.equal(h.input.presetDnd.type,PRESET_DRAG_TYPE);
    const protectedTransfer=h.transfer(payload);protectedTransfer.getData=()=>{throw Error('Protected drag data was read');};
    const over=h.event(30,{dataTransfer:protectedTransfer});h.handlers.get('dragover')(over);
    assert.equal(over.prevented,true);assert.equal(protectedTransfer.dropEffect,'copy');assert.equal(h.view.draft.target_clip_id,h.a.id);assert.equal(h.view.draft.name,h.item().name);assert.deepEqual(h.commands,[]);
    await h.drop(payload,35);assert.deepEqual(h.commands,[{kind:'apply_saved_preset',clip_ids:[h.a.id],preset_id:h.item().id,revision:h.item().revision}]);
    assert.deepEqual(h.view.selection,selection);assert.equal(h.selections(),0);assert.equal(h.view.draft,null);
  }finally{h.destroy();}
});

test('dropping on an already selected clip targets the whole selection and expands only the local linked preview',async()=>{
  const h=harness({linked:true});
  try{
    h.view.selection=[h.a.id,h.b.id];const selection=[...h.view.selection],payload=h.start();h.over(payload,105);
    assert.deepEqual(h.view.draft.clip_ids,selection);assert.deepEqual(h.view.draft.affected_ids,[h.a.id,h.b.id,h.audio.id]);assert.equal(h.view.draft.count,3);
    await h.drop(payload,105);assert.deepEqual(h.commands[0].clip_ids,selection);assert.deepEqual(h.view.selection,selection);assert.equal(h.selections(),0);
  }finally{h.destroy();}
});

test('release coordinates choose the actual clip beneath fade speed and transition handles',async()=>{
  for(const offset of [10,TRACK-14]){
    const h=harness();
    try{const y=timelineLayout(h.timeline(),h.view).trackTop(0)+offset,payload=h.start();h.over(payload,30,{y});await h.drop(payload,105,{y});assert.deepEqual(h.commands[0].clip_ids,[h.b.id]);}finally{h.destroy();}
  }
});

test('header ruler gaps inset margins outside canvas and clipped areas never become preset targets',async()=>{
  for(const extra of [{x:HEADER-1},{y:RULER-1},{y:RULER+2},{edge:'clipBottom'},{x:-1},{x:1500},{y:220},{y:-1}]){
    const h=harness();
    try{const point=extra.edge?{y:timelineLayout(h.timeline(),h.view).trackTop(0)+TRACK-1}:extra,payload=h.start();h.over(payload,30,point);assert.equal(h.view.draft,null);await h.drop(payload,30,point);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
  const h=harness();
  try{
    let payload=h.start();h.over(payload,90);assert.equal(h.view.draft,null);await h.drop(payload,90);assert.deepEqual(h.commands,[]);
    h.view.origin=30;payload=h.start();h.over(payload,30,{x:HEADER-1});assert.equal(h.view.draft,null);h.over(payload,30,{x:HEADER+1});assert.equal(h.view.draft.target_clip_id,h.a.id);
    h.input.presetDnd.end();h.view.scrollY=30;payload=h.start();h.over(payload,30,{y:RULER-1});assert.equal(h.view.draft,null);await h.drop(payload,30,{y:RULER-1});assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('locked targets or linked peers refuse atomically while mixed matching roles remain native authority',async()=>{
  for(const locked of [0,1]){
    const h=harness({linked:true});
    try{h.timeline().tracks[locked].locked=true;const payload=h.start();h.over(payload,30);assert.match(h.view.draft.error,/locked/);await h.drop(payload,30);assert.deepEqual(h.commands,[]);}finally{h.destroy();}
  }
  const h=harness({linked:true});
  try{
    h.setItem({...h.item(),video:false,audio:true});const payload=h.start();h.over(payload,30);assert.equal(h.view.draft.error,null);assert.equal(h.view.draft.count,2);await h.drop(payload,30);assert.deepEqual(h.commands[0].clip_ids,[h.a.id]);
  }finally{h.destroy();}
  const unmatched=harness();
  try{unmatched.setItem({...unmatched.item(),video:false,audio:true});const payload=unmatched.start();unmatched.over(payload,30);assert.match(unmatched.view.draft.error,/no matching/);await unmatched.drop(payload,30);assert.deepEqual(unmatched.commands,[]);}finally{unmatched.destroy();}
});

test('start requires valid active source metadata and synchronous current edit authority',()=>{
  const h=harness();
  try{
    const valid=h.item();
    for(const item of [{...valid,id:3},{...valid,id:'../look'},{...valid,revision:''},{...valid,name:''},{...valid,video:null},{...valid,video:false,audio:false},{...valid,archived:true},{...valid,error:'invalid'}])assert.equal(h.input.presetDnd.start(item,h.current),null);
    for(const callback of [undefined,()=>false,()=>Promise.resolve(true),()=>{throw Error('stale source');}])assert.equal(h.input.presetDnd.start(valid,callback),null);
    h.setWritable(false);assert.equal(h.start(),null);h.setWritable(true);h.setModal(true);assert.equal(h.start(),null);h.setModal(false);h.document.hidden=true;assert.equal(h.start(),null);
    assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('source CAS query selection viewport modal and timeline identity changes invalidate a trusted drag',async()=>{
  const changes={source:h=>h.setSourceValid(false),metadata:h=>h.setItem({...h.item(),revision:'preset-r2'}),epoch:h=>h.context().epoch='project:2',generation:h=>h.context().generation='1',revision:h=>h.timeline().revision='timeline-r2',object:h=>h.replaceTimeline(),selection:h=>h.view.selection=[],scale:h=>h.view.scale*=2,origin:h=>h.view.origin=1,scroll:h=>h.view.scrollY=1,playhead:h=>h.view.playhead=1,tool:h=>h.view.tool='slip',snap:h=>h.view.snap=false,transition:h=>h.view.transitionSelection={clip_id:h.a.id,slot:'in'},rect:h=>h.changeRect(),size:h=>h.canvas.clientWidth-=1,query:h=>h.context().frame=1,readonly:h=>h.setWritable(false),modal:h=>h.setModal(true)};
  for(const [name,change] of Object.entries(changes)){
    const h=harness();
    try{const payload=h.start();h.over(payload,30);change(h);await h.drop(payload,30);assert.deepEqual(h.commands,[],name);assert.equal(h.view.draft,null,name);}finally{h.destroy();}
  }
});

test('source callback reentrancy and protected drop reads cannot commit obsolete state',async()=>{
  const h=harness();
  try{
    let mutate=false;const payload=h.input.presetDnd.start(h.item(),()=>{if(mutate)h.view.selection=[];return true;});mutate=true;await h.drop(payload,30);assert.deepEqual(h.commands,[]);
    const next=h.start(),transfer=h.transfer(next);transfer.getData=()=>{h.context().generation='2';return next;};await h.handlers.get('drop')(h.event(30,{dataTransfer:transfer}));assert.deepEqual(h.commands,[]);assert.equal(h.view.draft,null);
  }finally{h.destroy();}
});

test('forged foreign stale or unreadable payloads never enter a command and one token cannot be replayed',async()=>{
  const h=harness();
  try{
    await h.drop('forged',30);assert.deepEqual(h.commands,[]);
    let payload=h.start();await h.drop(`${payload} `,30);assert.deepEqual(h.commands,[]);
    payload=h.start();const inaccessible=h.transfer(payload);inaccessible.getData=()=>{throw Error('Unavailable drag payload');};await h.handlers.get('drop')(h.event(30,{dataTransfer:inaccessible}));assert.deepEqual(h.commands,[]);
    const stale=h.start(),current=h.start();await h.drop(stale,30);assert.deepEqual(h.commands,[]);await h.drop(current,30);assert.deepEqual(h.commands,[]);
    payload=h.start();await h.drop(payload,30);await h.drop(payload,30);assert.equal(h.commands.length,1);
  }finally{h.destroy();}
});

test('async application blocks starts and pointer edits, preserves selection, and clears pending feedback after failure',async()=>{
  let reject;const h=harness({commit:()=>new Promise((_,no)=>{reject=no;})});
  try{
    const selection=[...h.view.selection],payload=h.start(),pending=h.drop(payload,30);assert.equal(h.commands.length,1);
    assert.equal(h.start(),null);assert.equal(h.input.transitionDnd.start('Push'),false);h.handlers.get('pointerdown')(h.event(30,{button:0,pointerId:7}));assert.deepEqual(h.view.selection,selection);
    await h.drop(payload,105);assert.equal(h.commands.length,1);reject(Error('Native preset changed'));await pending;assert.equal(h.view.draft,null);assert.match(h.notices.at(-1),/Native preset changed/);
    assert.equal(typeof h.start(),'string');
  }finally{h.destroy();}
});

test('Escape end cancel blur resize scroll visibility and wheel discard drafts without affecting selection',async()=>{
  for(const name of ['escape','end','cancel','dragend','blur','resize','scroll','visibility','wheel','leave']){
    const h=harness();
    try{
      const selection=[...h.view.selection],payload=h.start();h.over(payload,30);
      if(name==='escape')h.handlers.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});
      else if(name==='end')h.input.presetDnd.end();else if(name==='cancel')h.input.cancel();else if(name==='visibility'){h.document.hidden=true;h.documentHandlers.get('visibilitychange')();}
      else if(name==='wheel')h.handlers.get('wheel')(h.event(30,{deltaX:0,deltaY:1}));else if(name==='leave'){h.handlers.get('dragleave')({relatedTarget:null});assert.equal(h.view.draft,null);h.input.presetDnd.end();}
      else h.windowHandlers.get(name)();
      assert.equal(h.view.draft,null,name);await h.drop(payload,30);assert.deepEqual(h.commands,[],name);assert.deepEqual(h.view.selection,selection,name);
    }finally{h.destroy();}
  }
});

test('preset and transition starts cancel each other without displacing selection or sharing payloads',async()=>{
  const h=harness();
  try{
    assert.equal(h.input.transitionDnd.start('Push'),true);h.handlers.get('dragover')(h.event(21,{dataTransfer:{types:[TRANSITION_DRAG_TYPE],dropEffect:'none'}}));assert.equal(h.view.draft.kind,'transition_placement');
    const payload=h.start();h.over(payload,30);assert.equal(h.view.draft.kind,'preset_application');
    await h.handlers.get('drop')(h.event(21,{dataTransfer:{types:[TRANSITION_DRAG_TYPE],getData:()=>{throw Error('Canceled transition read');}}}));assert.deepEqual(h.commands,[]);
    assert.equal(h.input.transitionDnd.start('Push'),true);assert.equal(h.view.draft,null);await h.drop(payload,30);assert.deepEqual(h.commands,[]);
    const again=h.start();h.over(again,30);h.input.destroy();assert.equal(h.view.draft,null);assert.equal(h.input.presetDnd.start(h.item(),h.current),null);assert.equal(h.handlers.size,0);assert.equal(h.windowHandlers.size,0);assert.equal(h.documentHandlers.size,0);
  }finally{h.destroy();}
});

test('preset draft drawing outlines linked targets and presents literal name count and error cues',()=>{
  const h=harness({linked:true}),prior={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,devicePixelRatio:globalThis.devicePixelRatio,requestAnimationFrame:globalThis.requestAnimationFrame,ResizeObserver:globalThis.ResizeObserver},frames=[],calls=[];
  let draw;
  try{
    globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:name=>name});globalThis.devicePixelRatio=1.5;globalThis.requestAnimationFrame=fn=>frames.push(fn);globalThis.ResizeObserver=class{observe(){}disconnect(){}};
    const context=new Proxy({},{get:(_,method)=>(...args)=>calls.push({method,args})}),canvas={clientWidth:1500,clientHeight:220,getContext:()=>context};
    h.timeline().tracks[1].locked=true;h.view.draft=presetApplication(h.timeline(),h.view,[frameToX(30,h.view,h.timeline().fps),timelineLayout(h.timeline(),h.view).trackTop(0)+30],1500,220,h.item());
    draw=createDraw(canvas,h.timeline,h.view);frames.shift()();
    assert.ok(calls.some(call=>call.method==='fillText' && /Preset Native look <literal>.*2 clip.*blocked.*locked/.test(call.args[0])));
    assert.ok(calls.some(call=>call.method==='strokeRect' && call.args[1]>RULER+TRACK));assert.deepEqual(h.commands,[]);
  }finally{draw?.destroy();Object.assign(globalThis,prior);h.destroy();}
});
