import test from "node:test";
import assert from "node:assert/strict";
import {folderPaths, mediaSelection,visibleMediaDemand,mediaRowInfo,renderCatalog} from "../js/catalog.js";

test('pool derivative demand contains only intersecting native video/still thumbnails, never hidden, offline or compound media',()=>{
  const items=[{id:'video',has_video:true},{id:'still',has_video:true,is_image:true},{id:'audio',has_audio:true},{id:'hidden',has_video:true},{id:'offline',has_video:true,offline:true},{id:'compound',has_video:true,compound_timeline_id:'nested'}];
  assert.deepEqual(visibleMediaDemand(items,new Set(['video','still','audio','offline','compound'])),[{media_id:'video',audio_stream_index:0,include_waveform:false},{media_id:'still',audio_stream_index:0,include_waveform:false}]);
  assert.deepEqual(visibleMediaDemand(items,new Set()),[]);
});

test("media selection supports toggle, anchored ranges and stale IDs without project edits", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({id}));
  assert.deepEqual(mediaSelection(items, [], null, "b"), {selected: ["b"], anchor: "b"});
  assert.deepEqual(mediaSelection(items, ["b"], "b", "d", {extend: true}), {selected: ["b", "c", "d"], anchor: "b"});
  assert.deepEqual(mediaSelection(items, ["b", "c", "d"], "b", "c", {toggle: true}), {selected: ["b", "d"], anchor: "c"});
  assert.deepEqual(mediaSelection(items, ["b"], "b", "gone"), {selected: [], anchor: null});
});

test("folder paths preserve native IDs and terminate on malformed ancestry", () => {
  const folders = [{id: "1", name: "Scene", parent: null}, {id: "2", name: "Takes", parent: "1"}, {id: "3", name: "Cycle", parent: "3"}];
  const paths = folderPaths(folders);
  assert.equal(paths.find((f) => f.id === "2").path, "Scene / Takes");
  assert.equal(paths.find((f) => f.id === "3").path, "Cycle");
  assert.equal(folders[1].name, "Takes");
});

test("compact media rows describe native duration and type without inventing missing metadata",()=>{
  assert.deepEqual(mediaRowInfo({has_video:true,has_audio:true,audio_stream_count:2,duration_frames:144144,fps:{num:24000,den:1001}}),{metadata:"Video · 2 audio streams · 23.976 fps",duration:"1:40:12",glyph:"▻"});
  assert.deepEqual(mediaRowInfo({is_image:true,has_video:true,offline:true}),{metadata:"Still image · Offline",duration:"Still",glyph:"▣"});
  assert.equal(mediaRowInfo({has_audio:true,duration_frames:48000,fps:{num:48000,den:1}}).duration,"0:01");
  assert.equal(mediaRowInfo({has_video:true,duration_frames:48,fps:{num:24,den:1}}).metadata,"Video · 24 fps");
  assert.equal(mediaRowInfo({compound_timeline_id:"9007199254740993",has_video:true,duration_frames:3000,fps:{num:30,den:1}}).metadata,"Timeline · 30 fps");
  for(const fps of [undefined,{num:0,den:1},{num:24,den:0}])assert.equal(mediaRowInfo({has_video:true,duration_frames:100,fps}).duration,"—");
});

test("compact rows retain pool keyboard focus, Source opening, catalog actions and visible demand disposal",async()=>{
  const previous={document:globalThis.document,Option:globalThis.Option};let focused=null;
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className="";this.textContent="";this.isConnected=true;
      this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(" ").filter(Boolean));if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(" ");}};}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    insertBefore(node,before){node.parentElement=this;this.children.splice(this.children.indexOf(before),0,node);}
    setAttribute(key,value){this.attrs[key]=String(value);}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    fire(type,event={}){for(const callback of this.listeners[type]||[])callback({target:this,preventDefault(){},stopPropagation(){},...event});}
    get options(){return this.children;}
    focus(){focused=this;}
    querySelectorAll(selector){return this.children.flatMap(child=>{const matches=selector.startsWith(".")?child.className.split(" ").includes(selector.slice(1)):child.tag===selector;return [...(matches?[child]:[]),...child.querySelectorAll(selector)];});}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(label,value){super("option");this.textContent=label;this.value=value;}};
  let observer;
  class Observer {constructor(callback){this.callback=callback;this.observed=[];this.disconnections=0;observer=this;}observe(row){this.observed.push(row);}disconnect(){this.disconnections++;}}
  try{
    const root=new Element("div"),calls=[],opened=[],demand=[],selectionEvents=[],state={selected:[],folder:"*",open:false};
    const media=[{id:"9007199254740993",name:"<safe> first.mp4",has_video:true,duration_frames:48,fps:{num:24,den:1}},{id:"2",name:"Second.wav",has_audio:true,duration_frames:48000,fps:{num:48000,den:1}}];
    const catalog=renderCatalog(root,{media,folders:[]},state,{writable:true,assets:new Map([["thumb",{mediaId:media[0].id,thumbnail:{},thumbnailURL:"blob:owned"}]]),commit:async operation=>calls.push(operation),getFiles:async()=>[],onSelection:(id,ids,intent)=>selectionEvents.push({id,ids,...intent}),onOpen:id=>opened.push(id),notice:assert.fail,onDemand:items=>demand.push(items),intersectionObserver:Observer});
    const rows=root.querySelectorAll(".media-item"),list=root.querySelectorAll(".catalog-rows")[0];
    assert.equal(rows.length,2);assert.equal(rows[0].children[0].children[0].src,"blob:owned");assert.equal(rows[0].children[1].children[0].textContent,media[0].name);assert.equal(rows[0].children[2].textContent,"0:02");
    assert.equal(root.querySelectorAll(".catalog-operations")[0].open,false);
    assert.deepEqual(selectionEvents,[{id:null,ids:[],userIntent:false}]);
    rows[0].fire("click");assert.deepEqual(state.selected,[media[0].id]);assert.equal(rows[0].attrs["aria-pressed"],"true");assert.equal(selectionEvents.at(-1).userIntent,true);
    list.fire("keydown",{target:rows[0],key:"ArrowDown",shiftKey:true});assert.deepEqual(state.selected,media.map(item=>item.id));assert.equal(focused,rows[1]);assert.equal(selectionEvents.at(-1).userIntent,true);
    rows[0].fire("dblclick");assert.deepEqual(opened,[media[0].id]);assert.equal(calls.length,0);
    const actions=root.querySelectorAll("button");for(const label of ["Move selected media","Remove selected from project","Relink selected media","Create media folder","Rename current folder","Move current folder","Remove folder, keep contents"])assert.ok(actions.some(button=>button.textContent===label),label);
    actions.find(button=>button.textContent==="Move selected media").fire("click");assert.deepEqual(calls,[{kind:"edit_catalog",edit:{kind:"move_media",media_ids:media.map(item=>item.id),folder:null}}]);
    observer.callback([{target:rows[0],isIntersecting:true}]);assert.deepEqual(demand.at(-1),[{media_id:media[0].id,audio_stream_index:0,include_waveform:false}]);
    catalog.search('');assert.deepEqual(selectionEvents.at(-1),{id:media[1].id,ids:media.map(item=>item.id),userIntent:false});
    list.fire('keydown',{target:root.querySelectorAll('.media-item')[0],key:'a',ctrlKey:true});assert.equal(selectionEvents.at(-1).userIntent,true);
    catalog.dispose();assert.deepEqual(demand.at(-1),[]);const count=demand.length;observer.callback([{target:rows[0],isIntersecting:true}]);assert.equal(demand.length,count);
  }finally{globalThis.document=previous.document;globalThis.Option=previous.Option;}
});
