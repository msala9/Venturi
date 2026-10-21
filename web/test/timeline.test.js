import test from "node:test";
import assert from "node:assert/strict";
import {
  frameToX,
  xToFrame,
  snapFrame,
  hitTest,
  validateDraft,
  linkedSelection,
  playheadSelection,
  markerDraft,
  RULER,
} from "../js/timeline/geometry.js";
import { fixtureTimeline } from "../js/timeline/index.js";
import { createInput } from "../js/timeline/input.js";
const view = { scale: 120, origin: 17, scrollY: 0 };
test("playhead selection matches visible native video order, linked groups and locked targets",()=>{
  const clip=(id,start,length,group=null)=>({id,start_frame:start,length_frames:length,linked_group:group});
  const timeline={tracks:[{kind:"video",clips:[clip("bottom",0,30,"pair")]},{kind:"audio",clips:[clip("audio",0,30,"pair")]},{kind:"video",clips:[clip("top",10,10)]}]};
  assert.deepEqual(playheadSelection(timeline,5),["bottom","audio"]);assert.deepEqual(playheadSelection(timeline,10),["top"]);assert.deepEqual(playheadSelection(timeline,20),["bottom","audio"]);assert.deepEqual(playheadSelection(timeline,30),[]);
  timeline.tracks[2].muted=true;assert.deepEqual(playheadSelection(timeline,15),["bottom","audio"]);timeline.tracks[2].muted=false;timeline.tracks[2].clips[0].disabled=true;assert.deepEqual(playheadSelection(timeline,15),["bottom","audio"]);
  timeline.tracks[0].locked=true;assert.deepEqual(playheadSelection(timeline,15),["audio"]);timeline.tracks[1].locked=true;assert.deepEqual(playheadSelection(timeline,15),[]);assert.deepEqual(playheadSelection(null,0),[]);
});
test("marker lane has independent point/range hits and move/resize/extend previews preserve metadata",()=>{
  const fps={num:24,den:1},view={scale:240,origin:0,scrollY:0,snap:false};
  const marker={id:"9007199254740993",start_frame:20,duration_frames:10,note:"Cue <literal>",color:"Blue"};
  const timeline={fps,markers:[marker],tracks:[]};
  assert.equal(hitTest(frameToX(20,view,fps),32,timeline,view).edge,"start");
  assert.equal(hitTest(frameToX(25,view,fps),32,timeline,view).edge,null);
  assert.equal(hitTest(frameToX(30,view,fps),32,timeline,view).edge,"end");
  assert.equal(hitTest(frameToX(25,view,fps),14,timeline,view).kind,"scrub");
  assert.equal(hitTest(140,32,timeline,view).kind,"scrub");
  assert.deepEqual(markerDraft(marker,"move",35,25,[],view,fps),{...marker,start_frame:30});
  assert.deepEqual(markerDraft(marker,"start",29,20,[],view,fps),{...marker,start_frame:29,duration_frames:1});
  assert.deepEqual(markerDraft(marker,"end",15,30,[],view,fps),{...marker,duration_frames:0});
  assert.deepEqual(markerDraft({...marker,duration_frames:0},"extend",12,20,[],view,fps),{...marker,start_frame:12,duration_frames:8});
  assert.equal(markerDraft(marker,"move",0,25,[],view,fps).start_frame,0);
  assert.equal(markerDraft(marker,"move",27,25,[38],{...view,snap:true},fps).start_frame,22,"Outside eight CSS pixels stays unsnapped");
  assert.equal(markerDraft(marker,"move",32,25,[38],{...view,snap:true},fps).start_frame,27);
  assert.equal(markerDraft(marker,"move",32,25,[38],{...view,snap:true,scale:120},fps).start_frame,28,"Moving ranges can snap their far end");
});
for (const fps of [
  { num: 24000, den: 1001 },
  { num: 30000, den: 1001 },
])
  test(`frame coordinates roundtrip at ${fps.num}/${fps.den}`, () => {
    for (const frame of [0, 1, 17, 200, 999999])
      assert.equal(xToFrame(frameToX(frame, view, fps), view, fps), frame);
    assert.equal(snapFrame(101, [100], view, fps), 100);
    assert.equal(snapFrame(140, [100], view, fps), 140);
  });
test("safe move rejects occupied destinations, allows adjacency, checks locks", () => {
  const timeline = fixtureTimeline(),
    track = timeline.tracks[0],
    clip = track.clips[0];
  const change = {
    clip_id: clip.id,
    to_track: track.id,
    to_start_frame: 150,
    length_frames: 120,
  };
  assert.match(validateDraft(timeline, [change]), /Overlap/);
  assert.equal(
    validateDraft(timeline, [{ ...change, to_start_frame: 9450 }]),
    null,
  );
  track.locked = true;
  assert.match(validateDraft(timeline, [change]), /locked/);
});
test("fixture has 500 clips, hit zones and linked selection use string IDs", () => {
  const timeline = fixtureTimeline();
  assert.equal(timeline.tracks.flatMap((t) => t.clips).length, 500);
  const v = { ...view, origin: 0 };
  assert.equal(hitTest(152, RULER+15, timeline, v).kind, "trim_start");
  timeline.tracks[0].clips[0].linked_group = "g";
  timeline.tracks[4].clips[0].linked_group = "g";
  assert.equal(
    linkedSelection(timeline, [timeline.tracks[0].clips[0].id]).length,
    2,
  );
});
test("pointer gesture commits once after release; Escape and capture loss cancel", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const handlers = new Map();
  let calls = 0,
    captured = false;
  const canvas = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    focus() {},
    setPointerCapture() {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture() {
      captured = false;
    },
  };
  const timeline = fixtureTimeline(),
    view = {
      origin: 0,
      scale: 100,
      scrollY: 0,
      playhead: 0,
      selection: [],
      snap: false,
      draft: null,
    };
  const input = createInput({
    canvas,
    getTimeline: () => timeline,
    view,
    invalidate() {},
    onSelect() {},
    onSeek() {},
    onCommand: async () => {
      calls++;
    },
    onNotice() {},
  });
  const event = (x, y = 50) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    preventDefault() {},
  });
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  assert.equal(calls, 0);
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  handlers.get("keydown")({ key: "Escape" });
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  handlers.get("pointerdown")(event(190));
  handlers.get("pointermove")(event(198));
  handlers.get("lostpointercapture")();
  await handlers.get("pointerup")(event(198));
  assert.equal(calls, 1);
  input.destroy();
  delete globalThis.window;
});

test("marker gestures commit only at release, preserve point/range behavior and cancel without writes",async()=>{
  globalThis.window={addEventListener(){},removeEventListener(){}};
  const handlers=new Map(), commands=[], seeks=[], edits=[]; let captured=false,writable=true;
  const canvas={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0}),focus(){},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
  const fps={num:24,den:1},marker={id:"9007199254740993",start_frame:20,duration_frames:10,note:"Cue",color:"Orange"};
  const timeline={fps,markers:[marker],tracks:[]},view={origin:0,scale:240,scrollY:0,playhead:0,selection:[],snap:false,draft:null};
  const input=createInput({canvas,getTimeline:()=>timeline,view,invalidate(){},onSelect(){},onSeek:final=>seeks.push([final,view.playhead]),onCommand:async operation=>commands.push(operation),onNotice:message=>assert.fail(message),canEdit:()=>writable,onMarkerEdit:id=>edits.push(id)});
  const event=(frame,extra={})=>({clientX:frameToX(frame,view,fps),clientY:32,pointerId:1,button:0,preventDefault(){},...extra});
  handlers.get("pointerdown")(event(25)); handlers.get("pointermove")(event(35));
  assert.equal(commands.length,0);assert.equal(view.draft.marker.start_frame,30);
  await handlers.get("pointerup")(event(35));
  assert.deepEqual(commands,[{kind:"move_marker",marker_id:marker.id,start_frame:30,duration_frames:10}]);
  assert.equal(marker.start_frame,20,"Drafts never mutate the authoritative snapshot");
  for(const cancel of [()=>handlers.get("keydown")({key:"Escape"}),()=>handlers.get("lostpointercapture")(),()=>handlers.get("pointercancel")()]){
    handlers.get("pointerdown")(event(25)); handlers.get("pointermove")(event(35));cancel();await handlers.get("pointerup")(event(35));
  }
  assert.equal(commands.length,1);
  handlers.get("pointerdown")(event(20));handlers.get("pointermove")(event(23));await handlers.get("pointerup")(event(23));
  assert.deepEqual(commands.at(-1),{kind:"move_marker",marker_id:marker.id,start_frame:23,duration_frames:7});
  handlers.get("pointerdown")(event(30));handlers.get("pointermove")(event(36));await handlers.get("pointerup")(event(36));
  assert.deepEqual(commands.at(-1),{kind:"move_marker",marker_id:marker.id,start_frame:20,duration_frames:16});
  marker.duration_frames=0;
  handlers.get("pointerdown")(event(20,{altKey:true}));handlers.get("pointermove")(event(12));await handlers.get("pointerup")(event(12));
  assert.deepEqual(commands.at(-1),{kind:"move_marker",marker_id:marker.id,start_frame:12,duration_frames:8});
  const count=commands.length;writable=false;
  handlers.get("pointerdown")(event(20));handlers.get("pointermove")(event(30));await handlers.get("pointerup")(event(30));
  assert.equal(commands.length,count);assert.deepEqual(seeks.at(-1),[true,20]);
  handlers.get("dblclick")(event(20));assert.deepEqual(edits,[marker.id]);
  input.destroy();delete globalThis.window;
});
