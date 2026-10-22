import {timelineTimecode} from '../js/timeline/draw.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineLayout,paneScrollbars,clipsInTimelineRect,clickTimelineSelection,clipSelectionAnchor,moveTrackTargets,dragRangeAt,groupDragBounds,groupMoveStart,validateDraft,hitTest,frameToX,snapFrame,timelineScrollBounds,timelineOriginForFrame,kineticScrollStep,MIN_TIMELINE_SCALE,MAX_TIMELINE_SCALE,HEADER,RULER,TRACK,MAX_FRAME} from '../js/timeline/geometry.js';
import {createInput} from '../js/timeline/input.js';
import {presetApplication} from '../js/timeline/preset-drop.js';

const clip=(id,group=null)=>({id,start_frame:0,length_frames:10,linked_group:group,fade_in:0,fade_out:0});
const fixture=()=>({id:'timeline',revision:'revision',fps:{num:24,den:1},markers:[],tracks:[
  {id:'0',kind:'video',clips:[clip('10','linked')]},
  {id:'1',kind:'audio',clips:[clip('11','linked')]},
  {id:'2',kind:'video',clips:[clip('20')]},
  {id:'3',kind:'audio',clips:[clip('21')]},
  {id:'4',kind:'video',clips:[clip('30')]},
]});
const viewport=()=>({origin:0,scale:240,viewportHeight:RULER+5*TRACK+8,selection:[],selectionAnchor:null,playhead:0,tool:'move',snap:false,retimeVisible:new Set(),draft:null,lasso:null});

test('layout reverses only video display rows and retains interleaved native indices and IDs',()=>{
  const timeline=fixture(),before=structuredClone(timeline),view=viewport(),layout=timelineLayout(timeline,view);
  assert.deepEqual(layout.rowOrder,[4,2,0,1,3]);
  for(const index of layout.rowOrder)assert.equal(layout.trackAtY(layout.trackTop(index)+30),index);
  assert.equal(layout.trackTop(0),RULER+2*TRACK);
  assert.equal(layout.trackTop(1),RULER+3*TRACK+8);
  assert.equal(layout.trackAtY(layout.divider.top+4),null);
  assert.equal(layout.trackAtY(-1),null);assert.equal(layout.trackAtY(layout.height),null);
  assert.deepEqual(timeline,before);
});

test('separate panes clamp independent scroll and clip hidden rows at the divider',()=>{
  const timeline=fixture(),view={...viewport(),viewportHeight:220,videoPaneHeight:80,videoScroll:24,audioScroll:17},layout=timelineLayout(timeline,view);
  assert.equal(layout.videoScroll,24);assert.equal(layout.audioScroll,17);
  assert.equal(layout.videoPane.bottom,128);assert.equal(layout.audioPane.top,136);
  const hidden=layout.clipRect(4,timeline.tracks[4].clips[0],true),unclipped=layout.clipRect(4,timeline.tracks[4].clips[0]);
  assert.ok(hidden.bottom<=hidden.top);assert.ok(unclipped.top<RULER);
  assert.equal(layout.trackAtY(RULER+1),2);
  const clipped=layout.clipRect(1,timeline.tracks[1].clips[0],true);assert.equal(clipped.top,layout.audioPane.top);
  const moved=timelineLayout(timeline,{...view,audioScroll:100000});assert.equal(moved.videoScroll,24);assert.equal(moved.audioScroll,moved.audioMaxScroll);
  assert.equal(timelineLayout(timeline,{...view,videoPaneHeight:-100}).videoHeight,20);
  assert.equal(timelineLayout(timeline,{...view,videoPaneHeight:10000}).audioPane.bottom-timelineLayout(timeline,{...view,videoPaneHeight:10000}).audioPane.top,20);
});

test('Shift uses full displayed clip union; marquee uses only visible clips and excludes locked lanes before linked expansion',()=>{
  const timeline=fixture(),view=viewport(),anchor=clipSelectionAnchor(timeline,'10','epoch');
  assert.deepEqual(clickTimelineSelection(timeline,{ids:['30'],anchor},'21',{shift:true,projectEpoch:'epoch'},view).ids,['10','11','21']);
  timeline.tracks[3].locked=true;
  assert.equal(clickTimelineSelection(timeline,{ids:[],anchor},'21',{shift:true,projectEpoch:'epoch'},view),null);
  const cramped={...view,viewportHeight:220,videoPaneHeight:80},layout=timelineLayout(timeline,cramped),hidden=layout.clipRect(4,timeline.tracks[4].clips[0]);
  assert.deepEqual(clipsInTimelineRect(timeline,cramped,hidden),[]);
  assert.deepEqual(clipsInTimelineRect(timeline,cramped,hidden,{visible:false}),['30']);
  const all={left:HEADER,right:1000,top:0,bottom:1000};
  assert.deepEqual(clipsInTimelineRect(timeline,cramped,all),['10','11','20']);
});

test('hit tests and preset outlines use identical native row mapping and pane clipping',()=>{
  const timeline=fixture(),view=viewport(),layout=timelineLayout(timeline,view),x=frameToX(5,view,timeline.fps);
  for(const index of layout.rowOrder){const y=layout.trackTop(index)+30,hit=hitTest(x,y,timeline,view);assert.equal(hit.track,index);assert.equal(hit.clip.id,timeline.tracks[index].clips[0].id);}
  const item={id:'preset',revision:'revision',name:'Look',video:true,audio:false};
  const draft=presetApplication(timeline,view,[x,layout.trackTop(0)+30],1200,view.viewportHeight,item);
  assert.equal(draft.target_clip_id,'10');assert.deepEqual(draft.affected_ids,['10','11']);
  assert.deepEqual(draft.outlines.map(rect=>rect.track_id),['0','1']);
  assert.equal(draft.outlines[0].top,layout.clipRect(0,timeline.tracks[0].clips[0],true).top);
  assert.equal(hitTest(x,layout.divider.top+4,timeline,view).kind,'divider');
  assert.equal(hitTest(45,layout.trackTop(4)+TRACK/2,timeline,view).flag,'locked');
});

test('group moves translate native rows in opposite directions for linked audio and preserve original tracks when a destination is locked',()=>{
  const timeline=fixture(),view=viewport(),layout=timelineLayout(timeline,view),ids=['10','11'];
  const targets=moveTrackTargets(timeline,view,0,layout.trackTop(2)+30,ids);
  assert.deepEqual([...targets],[['10',2],['11',3]]);
  timeline.tracks[3].locked=true;
  assert.deepEqual([...moveTrackTargets(timeline,view,0,layout.trackTop(2)+30,ids)],[['10',0],['11',1]]);
  timeline.tracks[3].locked=false;
  const extended=moveTrackTargets(timeline,view,0,layout.trackTop(4)+30,ids);assert.deepEqual([...extended],[['10',4],['11',{kind:'audio',depth:1}]]);assert.equal(extended.new_video_tracks,0);assert.equal(extended.new_audio_tracks,1);
  assert.deepEqual([...moveTrackTargets(timeline,view,0,layout.trackTop(1)+30,ids)],[['10',0],['11',1]]);
});

test('native move snapping checks both endpoints at ten pixels with first-candidate ties',()=>{
  const view={scale:24,origin:0},fps={num:24,den:1};
  assert.equal(snapFrame(100,[128],view,fps,10,30),98);
  assert.equal(snapFrame(100,[95,105],view,fps),95);
  assert.equal(snapFrame(100,[111],view,fps),100);
  assert.equal(snapFrame(100,[101],{scale:2400},fps),100);
});

test('native new-track zones preserve group spacing and opposite role direction with one-based depths',()=>{
  const timeline=fixture(),view={...viewport(),viewportHeight:500},layout=timelineLayout(timeline,view);
  const video=moveTrackTargets(timeline,view,0,RULER+5,['10','11','30']);
  assert.deepEqual([...video],[['10',{kind:'video',depth:1}],['11',{kind:'audio',depth:2}],['30',{kind:'video',depth:3}]]);
  assert.equal(video.new_video_tracks,3);assert.equal(video.new_audio_tracks,2);
  assert.ok(layout.newTrackTop('video',1)<layout.trackTop(4));
  const audio=moveTrackTargets(timeline,view,1,layout.newTrackTop('audio',1)+10,['10','11']);
  assert.deepEqual([...audio],[['10',4],['11',{kind:'audio',depth:1}]]);assert.equal(audio.new_video_tracks,0);assert.equal(audio.new_audio_tracks,1);
  timeline.tracks[3].locked=true;
  const locked=moveTrackTargets(timeline,view,4,RULER+5,['30','11']);assert.deepEqual([...locked],[['11',1],['30',4]]);
  assert.equal(locked.new_video_tracks,undefined);
});

test('new-track group preflight refuses capacity without changing native arrays or allocating track identities',()=>{
  const timeline=fixture();while(timeline.tracks.length<128)timeline.tracks.push({id:String(timeline.tracks.length),kind:'audio',clips:[]});
  const before=structuredClone(timeline),view={...viewport(),viewportHeight:RULER+129*TRACK+8};
  const result=moveTrackTargets(timeline,view,0,RULER+5,['10','11']);assert.match(result.error,/128-track/);assert.equal(result.new_video_tracks,1);assert.deepEqual(timeline,before);
});

test('group bounds follow native destination neighbors and negative follower offsets around the raw reference',()=>{
  const timeline=fixture();timeline.tracks[0].clips=[{...clip('10'),start_frame:10}];timeline.tracks[1].clips=[{...clip('11'),start_frame:5},{...clip('outside'),start_frame:30}];
  const targets=new Map([['10',0],['11',1]]),view=viewport();
  assert.deepEqual(dragRangeAt(timeline,1,new Set(['10','11']),5,10),[0,20]);
  assert.deepEqual(groupDragBounds(timeline,'10',targets,0),[5,25]);
  assert.equal(groupMoveStart(timeline,view,'10',targets,0),5);
  // Native bounds ignore a clip intersecting RAW; the separate safe-move validator still refuses overwrite.
  const raw=28,start=groupMoveStart(timeline,view,'10',targets,raw);assert.equal(start,raw);
  assert.match(validateDraft(timeline,[{clip_id:'10',to_track:'0',to_start_frame:start,length_frames:10},{clip_id:'11',to_track:'1',to_start_frame:start-5,length_frames:10}]),/Overlap/);
});

test('group bounds exclude every moving member and bound empty new tracks at both frame limits',()=>{
  const timeline=fixture();timeline.tracks[0].clips=[{...clip('10'),start_frame:0},{...clip('middle'),start_frame:20},{...clip('later'),start_frame:40}];timeline.tracks[1].clips=[];
  const targets=new Map([['middle',1],['10',1],['later',{kind:'video',depth:1}]]),view=viewport();
  assert.deepEqual(groupDragBounds(timeline,'middle',targets,20),[20,MAX_FRAME-30]);
  assert.equal(groupMoveStart(timeline,view,'middle',targets,-100),20);assert.equal(groupMoveStart(timeline,view,'middle',targets,MAX_FRAME+100),MAX_FRAME-30);
  timeline.tracks[1].clips=[{...clip('neighbor'),start_frame:50,length_frames:5}];
  timeline.tracks[0].clips=[clip('10'),{...clip('later'),start_frame:5}];
  assert.deepEqual(groupDragBounds(timeline,'10',new Map([['10',1],['later',1]]),0),[0,35]);
});

test('group move clamps the raw candidate before snapping and clamps again to follower gap bounds',()=>{
  const timeline=fixture();timeline.tracks[0].clips=[{...clip('10'),start_frame:20}];timeline.tracks[1].clips=[{...clip('11'),start_frame:25,length_frames:20},{...clip('neighbor'),start_frame:46}];timeline.tracks[2].clips=[{...clip('snap'),start_frame:22,length_frames:1}];timeline.tracks[3].clips=[];timeline.tracks[4].clips=[];
  const targets=new Map([['10',0],['11',1]]),view={...viewport(),scale:24,snap:true};
  assert.deepEqual(groupDragBounds(timeline,'10',targets,20),[0,21]);assert.equal(groupMoveStart(timeline,view,'10',targets,20),21);
});

function harness(){
  const previous=globalThis.window,handlers=new Map(),windowHandlers=new Map(),captures=new Set(),commands=[],notices=[],seeks=[],timeline=fixture(),view=viewport();
  let writable=true,navigable=true,modal=false,selectionChanged=()=>{},rectOverrides={},clock=0,frameId=0,currentTimeline=timeline;
  const frames=new Map();
  const document={querySelector:()=>modal?{}:null,addEventListener(){},removeEventListener(){}};
  globalThis.window={document,devicePixelRatio:1,addEventListener:(name,handler)=>windowHandlers.set(name,handler),removeEventListener:name=>windowHandlers.delete(name)};
  const canvas={ownerDocument:document,clientWidth:1200,clientHeight:view.viewportHeight,style:{},getBoundingClientRect:()=>({left:0,top:0,width:1200,height:canvas.clientHeight,...rectOverrides}),addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener:name=>handlers.delete(name),focus(){},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);handlers.get('lostpointercapture')?.({pointerId:id});}};
  const input=createInput({canvas,getTimeline:()=>currentTimeline,getGapContext:()=>({project_epoch:'epoch',generation:'0'}),view,invalidate(){},onSelect(){selectionChanged();},onSeek(...args){seeks.push(args);},onCommand:async operation=>commands.push(operation),onNotice:message=>notices.push(message),canEdit:()=>writable,canNavigate:()=>navigable,now:()=>clock,requestFrame:fn=>{const id=++frameId;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id)});
  const send=(type,x,y,extra={})=>handlers.get(type)({clientX:x,clientY:y,pointerId:1,button:0,buttons:1,preventDefault(){},...extra});
  const advance=ms=>clock+=ms,tick=ms=>{clock+=ms;const pending=[...frames];frames.clear();for(const [,fn] of pending)fn(clock);};
  return {timeline,view,canvas,commands,notices,seeks,captures,handlers,windowHandlers,input,send,frames,advance,tick,setTimeline:value=>currentTimeline=value,setWritable:value=>writable=value,setNavigable:value=>navigable=value,setModal:value=>modal=value,setRect:value=>rectOverrides=value,setOnSelect:value=>selectionChanged=value,destroy(){input.destroy();globalThis.window=previous;}};
}

test('Inspector scroll queued by selection preserves a clip drag when fractional Canvas mapping is unchanged',async()=>{
  const h=harness();try{
    h.setRect({height:h.canvas.clientHeight-0.2});
    h.setOnSelect(()=>queueMicrotask(()=>h.windowHandlers.get('scroll')({type:'scroll',target:{id:'inspector-content'}})));
    const layout=timelineLayout(h.timeline,h.view),x=frameToX(5,h.view,h.timeline.fps),y=(layout.trackTop(0)+30)*(h.canvas.clientHeight-0.2)/h.canvas.clientHeight;
    h.send('pointerdown',x,y);await Promise.resolve();
    assert.equal(h.captures.size,1);assert.deepEqual(h.commands,[]);
    h.send('pointermove',x+120,y);assert.equal(h.view.draft.error,null);
    h.windowHandlers.get('scroll')({type:'scroll',target:{id:'inspector'}});
    assert.equal(h.captures.size,1);
    await h.send('pointerup',x+120,y,{buttons:0});
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'safe_move');assert.equal(h.captures.size,0);
  }finally{h.destroy();}
});

test('scroll still cancels clip gestures when Canvas mapping changes or a dialog or hidden document blocks them',async()=>{
  const changes=[h=>h.setRect({left:1}),h=>h.setRect({top:1}),h=>h.setRect({width:1199}),h=>h.setRect({height:h.canvas.clientHeight-0.2}),h=>h.canvas.clientWidth--,h=>h.canvas.clientHeight--,()=>window.devicePixelRatio=2,h=>h.setModal(true),h=>h.canvas.ownerDocument.hidden=true];
  for(const change of changes){
    const h=harness();try{
      const x=frameToX(5,h.view,h.timeline.fps),y=timelineLayout(h.timeline,h.view).trackTop(0)+30;
      h.send('pointerdown',x,y);h.send('pointermove',x+120,y);assert.ok(h.view.draft);
      change(h);h.windowHandlers.get('scroll')({type:'scroll',target:{id:'inspector'}});
      assert.equal(h.captures.size,0);assert.equal(h.view.draft,null);
      await h.send('pointerup',x+120,y,{buttons:0});assert.deepEqual(h.commands,[]);
    }finally{h.destroy();}
  }
});

test('divider drag is local and independently sized; Escape and capture loss restore the previous split without touching selection',async()=>{
  const h=harness();try{
    h.view.selection=['10'];const before=structuredClone(h.timeline),layout=timelineLayout(h.timeline,h.view),y=layout.divider.top+4;
    h.send('pointerdown',200,y);h.send('pointermove',200,y+30);assert.equal(h.view.videoPaneHeight,layout.videoHeight+30);assert.deepEqual(h.commands,[]);
    h.handlers.get('keydown')({key:'Escape'});assert.equal(h.view.videoPaneHeight,undefined);assert.equal(h.captures.size,0);assert.deepEqual(h.view.selection,['10']);
    h.send('pointerdown',200,y);h.send('pointermove',200,y-20);await h.send('pointerup',200,y-20,{buttons:0});assert.equal(h.view.videoPaneHeight,layout.videoHeight-20);assert.deepEqual(h.commands,[]);assert.deepEqual(h.timeline,before);
    const retained=h.view.videoPaneHeight,y2=timelineLayout(h.timeline,h.view).divider.top+4;
    h.send('pointerdown',200,y2);h.send('pointermove',200,y2+15);h.handlers.get('pointercancel')({pointerId:1});assert.equal(h.view.videoPaneHeight,retained);
  }finally{h.destroy();}
});

test('wheel scrolls only the pointed pane and Shift zooms rows without a native mutation',()=>{
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;
    h.send('wheel',300,RULER+10,{deltaY:-30,deltaX:0});assert.equal(h.view.videoScroll,30);assert.equal(h.view.audioScroll,0);
    h.send('wheel',300,150,{deltaY:20,deltaX:0});assert.equal(h.view.videoScroll,30);assert.equal(h.view.audioScroll,20);
    h.send('wheel',300,150,{deltaY:-20,deltaX:0,shiftKey:true});assert.ok(h.view.rowHeight>TRACK);assert.equal(h.view.origin,0);assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('native pane scrollbar geometry reverses video offset, clamps the thumb and disappears without overflow',()=>{
  const timeline=fixture(),view={...viewport(),viewportHeight:220,videoPaneHeight:80,videoScroll:0,audioScroll:0},before=structuredClone(timeline);
  const [video,audio]=paneScrollbars(timeline,view,1200);
  assert.deepEqual([video.pane,audio.pane],['video','audio']);assert.equal(video.offset,video.maxOffset);assert.equal(audio.offset,0);
  assert.equal(video.left,1190);assert.equal(video.right,1198);assert.equal(video.top,RULER+2);
  assert.ok(video.thumbHeight>=16);assert.ok(Math.abs(video.thumbTop+video.thumbHeight-video.bottom)<1e-9);assert.equal(audio.thumbTop,audio.top);
  const atLimit=paneScrollbars(timeline,{...view,videoScroll:100000,audioScroll:100000},1200);
  assert.equal(atLimit[0].offset,0);assert.equal(atLimit[1].offset,atLimit[1].maxOffset);
  assert.deepEqual(paneScrollbars(timeline,viewport(),1200),[]);assert.deepEqual(paneScrollbars(timeline,view,HEADER+5),[]);
  assert.deepEqual(timeline,before);
});

test('pane rails win hit testing over clips only inside the visible native rail',()=>{
  const timeline=fixture(),view={...viewport(),viewportHeight:220,videoPaneHeight:80};
  for(const bar of paneScrollbars(timeline,view,1200)){
    const y=(bar.top+bar.bottom)/2;
    assert.equal(hitTest(1194,y,timeline,view,1200).pane,bar.pane);
    assert.notEqual(hitTest(1189,y,timeline,view,1200).kind,'pane_scrollbar');
  }
  assert.equal(hitTest(1194,timelineLayout(timeline,view).divider.top+4,timeline,view,1200).kind,'divider');
});

test('pane rail clicks center on release, preserve selection and work in a read-only session',async()=>{
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;h.view.selection=['10'];h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'10','epoch');h.view.playhead=7;h.setWritable(false);
    const selection=structuredClone([h.view.selection,h.view.selectionAnchor,h.view.playhead]),before=structuredClone(h.timeline);let notifications=0;h.setOnSelect(()=>notifications++);
    const [video,audio]=paneScrollbars(h.timeline,h.view,1200,h.canvas.clientHeight);
    h.send('pointerdown',1194,video.top);assert.equal(h.view.videoScroll,0);assert.equal(h.captures.size,1);
    await h.send('pointerup',1194,video.top,{buttons:0});assert.equal(h.view.videoScroll,video.maxOffset);assert.equal(h.view.audioScroll,0);
    h.send('pointerdown',1194,audio.bottom);await h.send('pointerup',1194,audio.bottom,{buttons:0});assert.equal(h.view.audioScroll,audio.maxOffset);
    assert.deepEqual([h.view.selection,h.view.selectionAnchor,h.view.playhead],selection);assert.equal(notifications,0);assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);assert.deepEqual(h.timeline,before);assert.equal(h.captures.size,0);
  }finally{h.destroy();}
});

test('captured scrollbar drag maps pixel travel independently and clamps either end without commands',async()=>{
  for(const pane of ['video','audio']){
    const h=harness();try{
      h.canvas.clientHeight=220;h.view.videoPaneHeight=80;
      const bar=paneScrollbars(h.timeline,h.view,1200,h.canvas.clientHeight).find(bar=>bar.pane===pane),y=bar.thumbTop+bar.thumbHeight/2,delta=pane==='video'?-12:12;
      h.send('pointerdown',1194,y);h.send('pointermove',1194,y+delta);
      const expected=Math.max(0,Math.min(bar.maxOffset,bar.offset+delta*bar.maxOffset/bar.travel));
      assert.ok(Math.abs(h.view[pane==='video'?'videoScroll':'audioScroll']-(pane==='video'?bar.maxOffset-expected:expected))<1e-9);
      h.send('pointermove',1194,pane==='video'?-1000:1000);await h.send('pointerup',1194,pane==='video'?-1000:1000,{buttons:0});
      assert.equal(h.view[pane==='video'?'videoScroll':'audioScroll'],bar.maxOffset);assert.equal(h.view[pane==='video'?'audioScroll':'videoScroll'],0);assert.deepEqual(h.commands,[]);assert.equal(h.captures.size,0);
    }finally{h.destroy();}
  }
});

test('scrollbar cancellation rolls back only its owned offset and never clears the current clip or gap selection',async()=>{
  for(const abort of ['escape','capture','modal','navigation']){
    const h=harness();try{
      h.canvas.clientHeight=220;h.view.videoPaneHeight=80;h.view.selection=['10'];h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'10','epoch');
      const before=structuredClone([h.view.selection,h.view.selectionAnchor]),bar=paneScrollbars(h.timeline,h.view,1200,h.canvas.clientHeight)[0],y=bar.thumbTop+bar.thumbHeight/2;
      h.send('pointerdown',1194,y);h.send('pointermove',1194,y-12);assert.ok(h.view.videoScroll>0);
      if(abort==='escape')h.handlers.get('keydown')({key:'Escape'});
      if(abort==='capture')h.handlers.get('pointercancel')({pointerId:1});
      if(abort==='modal'){h.setModal(true);await h.send('pointerup',1194,y-12,{buttons:0});}
      if(abort==='navigation'){h.setNavigable(false);await h.send('pointerup',1194,y-12,{buttons:0});}
      assert.equal(h.view.videoScroll,0);assert.deepEqual([h.view.selection,h.view.selectionAnchor],before);assert.equal(h.captures.size,0);assert.deepEqual(h.commands,[]);
    }finally{h.destroy();}
  }
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;const gap={timeline_id:'timeline',revision:'revision',track_id:'0',frame:0,start_frame:0,length_frames:20,context:JSON.stringify(['timeline','revision',{project_epoch:'epoch',generation:'0'}])};h.timeline.tracks[0].clips[0].start_frame=20;h.timeline.gaps=[{track_id:'0',start_frame:0,length_frames:20}];h.view.selectedGap=gap;
    const bar=paneScrollbars(h.timeline,h.view,1200,h.canvas.clientHeight)[0],y=bar.thumbTop+bar.thumbHeight/2;h.send('pointerdown',1194,y);h.send('pointermove',1194,y-12);h.handlers.get('keydown')({key:'Escape'});assert.equal(h.view.selectedGap,gap);
  }finally{h.destroy();}
});

test('stale scrollbar release cannot overwrite a new timeline offset or newer selection intent',async()=>{
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;
    const bar=paneScrollbars(h.timeline,h.view,1200,h.canvas.clientHeight)[0],y=bar.thumbTop+bar.thumbHeight/2;h.send('pointerdown',1194,y);h.send('pointermove',1194,y-12);
    h.timeline.revision='new';h.view.videoScroll=42;h.view.selection=['20'];h.view.selectionAnchor=clipSelectionAnchor(h.timeline,'20','epoch');
    await h.send('pointerup',1194,y-30,{buttons:0});assert.equal(h.view.videoScroll,42);assert.deepEqual(h.view.selection,['20']);assert.equal(h.view.selectionAnchor.clip_id,'20');assert.equal(h.captures.size,0);assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('native wheel modifiers use Alt playhead-centered zoom, Ctrl horizontal pan and Shift row zoom',()=>{
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;h.view.playhead=20;h.view.origin=5;
    const screenFrame=frameToX(h.view.playhead,h.view,h.timeline.fps),oldScale=h.view.scale;
    h.send('wheel',900,100,{deltaY:-20,deltaX:0,altKey:true});assert.ok(h.view.scale>oldScale);assert.ok(Math.abs(frameToX(h.view.playhead,h.view,h.timeline.fps)-screenFrame)<1e-9);
    const scale=h.view.scale,origin=h.view.origin;h.send('wheel',900,100,{deltaY:40,deltaX:0,ctrlKey:true});assert.equal(h.view.scale,scale);assert.ok(h.view.origin>origin);assert.equal(h.view.videoScroll,0);
    const row=h.view.rowHeight ?? TRACK,origin2=h.view.origin;h.send('wheel',900,100,{deltaY:-20,deltaX:0,shiftKey:true});assert.ok(h.view.rowHeight>row);assert.equal(h.view.origin,origin2);assert.equal(h.view.scale,scale);
    assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
  }finally{h.destroy();}
});

test('wheel normalizes line deltas and leaves Meta, blocked navigation, modals and consumed events untouched',()=>{
  const h=harness();try{
    h.canvas.clientHeight=220;h.view.videoPaneHeight=80;h.send('wheel',300,150,{deltaY:1,deltaX:0,deltaMode:1});assert.equal(h.view.audioScroll,16);
    for(const guard of ['meta','modal','navigation','prevented']){
      h.setModal(guard==='modal');h.setNavigable(guard!=='navigation');const before=structuredClone(h.view);let prevented=false;
      h.send('wheel',300,150,{deltaY:20,deltaX:10,metaKey:guard==='meta',defaultPrevented:guard==='prevented',preventDefault(){prevented=true;}});
      assert.deepEqual(h.view,before);assert.equal(prevented,false);
    }
    assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('native scroll friction stops finite motion, clamps either boundary and caps elapsed time after a delayed frame',()=>{
  assert.deepEqual(kineticScrollStep(20,100,100,.1),{offset:25,velocity:50,moved:true});
  assert.deepEqual(kineticScrollStep(20,-100,100,.1),{offset:15,velocity:-50,moved:true});
  assert.deepEqual(kineticScrollStep(99,100,100,.1),{offset:100,velocity:0,moved:true});
  assert.deepEqual(kineticScrollStep(1,-100,100,.1),{offset:0,velocity:0,moved:true});
  assert.deepEqual(kineticScrollStep(20,14,100,.016),{offset:20,velocity:0,moved:false});
  assert.deepEqual(kineticScrollStep(20,100,100,10),kineticScrollStep(20,100,100,.1));
  assert.deepEqual(kineticScrollStep(0,NaN,100,.1),{offset:0,velocity:0,moved:false});
  let state={offset:0,velocity:1600},frames=0;while(state.velocity && frames++<1000)state=kineticScrollStep(state.offset,state.velocity,100000,.016);
  assert.ok(frames<1000);assert.equal(state.velocity,0);assert.ok(state.offset>2000 && state.offset<3000);
});

test('horizontal bounds and one-third playhead reveal use native twenty-second content and five-second tail at rational fps',()=>{
  const timeline=fixture(),view={...viewport(),scale:60};let bounds=timelineScrollBounds(timeline,view,HEADER+600);
  assert.equal(bounds.maxOffset,600);assert.equal(bounds.maxOrigin,240);assert.equal(bounds.viewportFrames,240);
  assert.equal(timelineOriginForFrame(timeline,view,HEADER+600,240),0,'The native right boundary remains visible');
  assert.equal(timelineOriginForFrame(timeline,view,HEADER+600,241),161);assert.equal(timelineOriginForFrame(timeline,view,HEADER+600,400),240);
  assert.equal(timelineScrollBounds(timeline,view,HEADER+2000).maxOrigin,0);
  timeline.fps={num:30000,den:1001};timeline.tracks[0].clips[0].length_frames=3000;
  bounds=timelineScrollBounds(timeline,view,HEADER+600);assert.ok(Math.abs(bounds.maxOffset-5706)<1e-9);
  const before=JSON.stringify(timeline);assert.equal(timelineOriginForFrame(timeline,{...view,origin:1e9},HEADER+600,0),0);assert.equal(JSON.stringify(timeline),before);
});

async function fling(h,{pane='video',dx=-20,dy=10}={}){
  h.canvas.clientHeight=220;h.view.videoPaneHeight=80;h.view.origin=100;
  const y=pane==='audio'?170:pane==='video'?RULER+10:10;
  h.send('pointerdown',600,y,{button:1,buttons:4});h.advance(20);h.send('pointermove',600+dx,y+dy,{button:-1,buttons:4});
  await h.send('pointerup',600+dx,y+dy,{button:1,buttons:0});
}

test('released pointer pan coasts only its native pane with gain1.6, no mutation or selection change',async()=>{
  const h=harness();try{
    h.view.selection=['10'];const before=JSON.stringify(h.timeline);await fling(h);assert.equal(h.captures.size,0);assert.equal(h.frames.size,1);assert.equal(h.input.navigationIdle(),false);const origin=h.view.origin,vertical=h.view.videoScroll;
    h.tick(16);assert.ok(Math.abs(h.view.origin-origin-2.5472)<1e-9);assert.ok(Math.abs(h.view.videoScroll-vertical-12.672)<1e-9);assert.equal(h.view.audioScroll,0);assert.deepEqual(h.view.selection,['10']);assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);assert.equal(JSON.stringify(h.timeline),before);
    h.windowHandlers.get('pointermove')({movementX:1});const retained=JSON.stringify([h.view.origin,h.view.videoScroll]);h.tick(100);assert.equal(h.frames.size,0);assert.equal(JSON.stringify([h.view.origin,h.view.videoScroll]),retained);assert.equal(h.input.navigationIdle(),true);
  }finally{h.destroy();}
});

test('audio pan direction and bound stop are independent, while ruler pans still coast horizontally',async()=>{
  const h=harness();try{
    h.view.audioScroll=30;await fling(h,{pane:'audio',dx:0,dy:-10});assert.equal(h.view.audioScroll,40);assert.equal(h.view.videoScroll,0);h.tick(16);assert.ok(h.view.audioScroll>40);for(let index=0;index<20 && h.frames.size;index++)h.tick(16);
    assert.equal(h.view.audioScroll,timelineLayout(h.timeline,h.view).audioMaxScroll);assert.equal(h.frames.size,0);assert.deepEqual(h.commands,[]);
    await fling(h,{pane:null,dy:0});assert.equal(h.frames.size,1);const origin=h.view.origin;h.tick(16);assert.ok(h.view.origin>origin);
  }finally{h.destroy();}
});

test('OS wheel momentum is authoritative without an extra synthetic tail and native zoom and horizontal limits are enforced',()=>{
  const h=harness();try{
    h.view.origin=10;for(const deltaX of [10,7,3])h.send('wheel',500,100,{deltaX,deltaY:0});assert.equal(h.view.origin,12);assert.equal(h.frames.size,0);h.tick(1000);assert.equal(h.view.origin,12);
    h.send('wheel',500,100,{deltaX:1e9,deltaY:0});assert.equal(h.view.origin,timelineScrollBounds(h.timeline,h.view,h.canvas.clientWidth).maxOrigin);h.send('wheel',500,100,{deltaX:-1e9,deltaY:0});assert.equal(h.view.origin,0);
    h.send('wheel',500,100,{deltaY:1e6,deltaX:0,altKey:true});assert.equal(h.view.scale,MIN_TIMELINE_SCALE);assert.equal(h.view.origin,0);
    h.send('wheel',500,100,{deltaY:-1e6,deltaX:0,altKey:true});assert.equal(h.view.scale,MAX_TIMELINE_SCALE);assert.equal(h.frames.size,0);assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('new input, stale context, hidden documents and external viewport changes terminate an owned coast',async()=>{
  const changes=[h=>h.windowHandlers.get('pointerdown')({}),h=>h.windowHandlers.get('keydown')({key:'a'}),h=>h.send('wheel',500,100,{deltaY:1,deltaX:0}),h=>h.windowHandlers.get('blur')(),h=>h.setModal(true),h=>h.canvas.ownerDocument.hidden=true,h=>h.timeline.revision='new',h=>h.setTimeline({...h.timeline}),h=>h.setNavigable(false),h=>h.setRect({left:1}),h=>h.view.origin++,h=>h.view.selection=['other']];
  for(const change of changes){const h=harness();try{await fling(h);assert.equal(h.frames.size,1);change(h);const retained=JSON.stringify([h.view.origin,h.view.videoScroll,h.view.audioScroll]);h.tick(16);assert.equal(h.frames.size,0);assert.equal(JSON.stringify([h.view.origin,h.view.videoScroll,h.view.audioScroll]),retained);assert.deepEqual(h.commands,[]);}finally{h.destroy();}}
});

test('a canceled late animation callback cannot erase a replacement coast and delayed pointer release cannot launch a stale fling',async()=>{
  const h=harness();try{
    await fling(h);const old=[...h.frames.values()][0];h.windowHandlers.get('pointermove')({movementX:1});await fling(h);const keys=[...h.frames.keys()],origin=h.view.origin;old(1000);assert.deepEqual([...h.frames.keys()],keys);assert.equal(h.view.origin,origin);h.tick(16);assert.ok(h.view.origin>origin);h.input.cancel();
    const y=RULER+10;h.send('pointerdown',600,y,{button:1,buttons:4});h.advance(20);h.send('pointermove',580,y,{buttons:4});h.advance(150);await h.send('pointerup',580,y,{button:1,buttons:0});assert.equal(h.frames.size,0);assert.deepEqual(h.commands,[]);
  }finally{h.destroy();}
});

test('header flag gesture commits the mapped native ID once on release and refuses stale or read-only clicks',async()=>{
  const h=harness();try{
    const top=timelineLayout(h.timeline,h.view).trackTop(4),y=top+TRACK/2;
    h.send('pointerdown',45,y);h.send('pointermove',46,y);assert.deepEqual(h.commands,[]);await h.send('pointerup',46,y,{buttons:0});assert.deepEqual(h.commands,[{kind:'set_track',track:'4',locked:true}]);
    h.send('pointerdown',45,y);h.timeline.revision='changed';await h.send('pointerup',45,y,{buttons:0});assert.equal(h.commands.length,1);
    h.setWritable(false);h.send('pointerdown',45,y);await h.send('pointerup',45,y,{buttons:0});assert.equal(h.commands.length,1);assert.ok(h.notices.length);
  }finally{h.destroy();}
});

test('linked pointer group move previews correct mapped tracks then emits one safe_move; locked destinations keep both original lanes',async()=>{
  for(const locked of [false,true]){
    const h=harness();try{
      h.timeline.tracks[3].locked=locked;h.view.selection=['10','11'];
      const layout=timelineLayout(h.timeline,h.view),x=frameToX(5,h.view,h.timeline.fps);
      h.send('pointerdown',x,layout.trackTop(0)+30);h.send('pointermove',x+120,layout.trackTop(2)+30);
      assert.deepEqual(h.commands,[]);assert.equal(h.view.draft.error,null);
      assert.deepEqual(h.view.draft.changes.map(change=>change.to_track),locked?['0','1']:['2','3']);
      await h.send('pointerup',x+120,layout.trackTop(2)+30,{buttons:0});assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'safe_move');
    }finally{h.destroy();}
  }
});

test('new-track pointer gestures publish one atomic move_clips DTO on release and Escape never writes partial AddTrack',async()=>{
  for(const cancel of [false,true]){
    const h=harness();try{
      h.canvas.clientHeight=500;h.view.viewportHeight=500;h.view.selection=['10','11'];
      const before=structuredClone(h.timeline),layout=timelineLayout(h.timeline,h.view),x=frameToX(5,h.view,h.timeline.fps);
      h.send('pointerdown',x,layout.trackTop(0)+30);h.send('pointermove',x+120,RULER+5);
      assert.equal(h.view.draft.error,null);assert.equal(h.view.draft.new_video_tracks,1);assert.equal(h.view.draft.new_audio_tracks,2);assert.deepEqual(h.commands,[]);assert.deepEqual(h.timeline,before);
      if(cancel){h.handlers.get('keydown')({key:'Escape'});assert.deepEqual(h.commands,[]);assert.equal(h.view.draft,null);}
      else{
        await h.send('pointerup',x+120,RULER+5,{buttons:0});
        assert.deepEqual(h.commands,[{kind:'move_clips',new_video_tracks:1,new_audio_tracks:2,moves:[{clip_id:'10',to_start_frame:12,to_track:{kind:'new',depth:1}},{clip_id:'11',to_start_frame:12,to_track:{kind:'new',depth:2}}]}]);
      }
      assert.deepEqual(h.timeline,before);assert.equal(h.captures.size,0);
    }finally{h.destroy();}
  }
});

test('pointer group move clamps a negative-offset linked follower at zero before the sole release command',async()=>{
  const h=harness();try{
    h.timeline.tracks[0].clips[0].start_frame=40;h.timeline.tracks[1].clips[0].start_frame=20;h.view.selection=['10','11'];
    const y=timelineLayout(h.timeline,h.view).trackTop(0)+30;
    h.send('pointerdown',frameToX(45,h.view,h.timeline.fps),y);h.send('pointermove',HEADER+10,y);
    assert.equal(h.view.draft.error,null);assert.deepEqual(h.view.draft.changes.map(change=>change.to_start_frame),[20,0]);assert.deepEqual(h.commands,[]);
    await h.send('pointerup',HEADER+10,y,{buttons:0});assert.equal(h.commands.length,1);assert.equal(h.commands[0].kind,'safe_move');assert.deepEqual(h.commands[0].moves.map(change=>change.to_start_frame),[20,0]);
  }finally{h.destroy();}
});

test('native ruler uses non-drop nominal timecode for integer and fractional timeline rates',()=>{
 assert.equal(timelineTimecode(1842,{num:60,den:1}),'00:00:30:42');
 assert.equal(timelineTimecode(1800,{num:30000,den:1001}),'00:01:00:00');
 assert.equal(timelineTimecode(107999,{num:30000,den:1001}),'00:59:59:29');
 assert.equal(timelineTimecode(24,{num:24,den:1}),'00:00:01:00');
});
