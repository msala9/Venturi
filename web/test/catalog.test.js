import test from "node:test";
import assert from "node:assert/strict";
import {folderPaths, mediaSelection,visibleMediaDemand,mediaRowInfo,renderCatalog,compareMediaNames,sortMediaItems} from "../js/catalog.js";

test('native catalog sort uses lowercase lexical names with exact-case ties and duration ties by name, reversing the complete comparison',()=>{
  const items=[['10','clip2',48,24],['2','clip10',96,48],['3','Clip2',24,24],['4','clip2',30,30]].map(([id,name,duration_frames,num])=>({id,name,duration_frames,fps:{num,den:1}}));
  assert.deepEqual(sortMediaItems(items).map(item=>item.id),['2','3','10','4'],'native natural_cmp does not interpret numeric filename suffixes');
  assert.deepEqual(sortMediaItems(items,{key:'duration',ascending:true}).map(item=>item.id),['3','4','2','10']);
  assert.deepEqual(sortMediaItems(items,{key:'duration',ascending:false}).map(item=>item.id),['10','2','4','3']);
  assert.deepEqual(items.map(item=>item.id),['10','2','3','4']);assert.ok(compareMediaNames('\u{10000}','\ue000')>0,'native UTF-8 order follows Unicode code points');
  assert.equal(compareMediaNames('same','same'),0);assert.ok(compareMediaNames('A','a')<0);
});

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

class Element {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className="";this.textContent="";this.isConnected=true;
      this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(" ").filter(Boolean));if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(" ");}};}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
    insertBefore(node,before){node.parentElement=this;this.children.splice(this.children.indexOf(before),0,node);}
    setAttribute(key,value){this.attrs[key]=String(value);}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
    fire(type,values={}){const event={target:this,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const callback of this.listeners[type]||[])callback(event);return event;}
    get options(){return this.children;}
    focus(){globalThis.document.activeElement=this;}
    reportValidity(){return true;}
    querySelectorAll(selector){return this.children.flatMap(child=>{const matches=selector.startsWith(".")?child.className.split(" ").includes(selector.slice(1)):child.tag===selector;return [...(matches?[child]:[]),...child.querySelectorAll(selector)];});}
}
async function withCatalogDom(run){
  const previous={document:globalThis.document,Option:globalThis.Option};
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(label,value){super("option");this.textContent=label;this.value=value;}};
  try{return await run();}finally{globalThis.document=previous.document;globalThis.Option=previous.Option;}
}

test("compact rows retain pool keyboard focus, Source opening, catalog actions and visible demand disposal",async()=>withCatalogDom(async()=>{
  let observer;
  class Observer {constructor(callback){this.callback=callback;this.observed=[];this.disconnections=0;observer=this;}observe(row){this.observed.push(row);}disconnect(){this.disconnections++;}}
    const root=new Element("div"),calls=[],opened=[],demand=[],selectionEvents=[],state={selected:[],folder:"*",open:false};
    const media=[{id:"9007199254740993",name:"<safe> first.mp4",has_video:true,duration_frames:48,fps:{num:24,den:1}},{id:"2",name:"Second.wav",has_audio:true,duration_frames:48000,fps:{num:48000,den:1}}];
    const catalog=renderCatalog(root,{media,folders:[]},state,{writable:true,assets:new Map([["thumb",{mediaId:media[0].id,thumbnail:{},thumbnailURL:"blob:owned"}]]),commit:async operation=>calls.push(operation),getFiles:async()=>[],onSelection:(id,ids,intent)=>selectionEvents.push({id,ids,...intent}),onOpen:id=>opened.push(id),notice:assert.fail,onDemand:items=>demand.push(items),intersectionObserver:Observer});
    const rows=root.querySelectorAll(".media-item"),list=root.querySelectorAll(".catalog-rows")[0];
    assert.equal(rows.length,2);assert.equal(rows[0].children[0].children[0].src,"blob:owned");assert.equal(rows[0].children[1].children[0].textContent,media[0].name);assert.equal(rows[0].children[2].textContent,"0:02");
    assert.equal(root.querySelectorAll(".catalog-operations")[0].open,false);
    assert.deepEqual(selectionEvents,[{id:null,ids:[],userIntent:false}]);
    rows[0].fire("click");assert.deepEqual(state.selected,[media[0].id]);assert.equal(rows[0].attrs["aria-pressed"],"true");assert.equal(selectionEvents.at(-1).userIntent,true);
    list.fire("keydown",{target:rows[0],key:"ArrowDown",shiftKey:true});assert.deepEqual(state.selected,media.map(item=>item.id));assert.equal(globalThis.document.activeElement,rows[1]);assert.equal(selectionEvents.at(-1).userIntent,true);
    rows[0].fire("dblclick");assert.deepEqual(opened,[media[0].id]);assert.equal(calls.length,0);
    const actions=root.querySelectorAll("button");for(const label of ["Move selected media","Remove selected from project","Relink selected media","Create media folder","Rename current folder","Move current folder","Remove folder, keep contents"])assert.ok(actions.some(button=>button.textContent===label),label);
    actions.find(button=>button.textContent==="Move selected media").fire("click");assert.deepEqual(calls,[{kind:"edit_catalog",edit:{kind:"move_media",media_ids:media.map(item=>item.id),folder:null}}]);
    observer.callback([{target:rows[0],isIntersecting:true}]);assert.deepEqual(demand.at(-1),[{media_id:media[0].id,audio_stream_index:0,include_waveform:false}]);
    catalog.search('');assert.deepEqual(selectionEvents.at(-1),{id:media[1].id,ids:media.map(item=>item.id),userIntent:false});
    list.fire('keydown',{target:root.querySelectorAll('.media-item')[0],key:'a',ctrlKey:true});assert.equal(selectionEvents.at(-1).userIntent,true);
    catalog.dispose();assert.deepEqual(demand.at(-1),[]);const count=demand.length;observer.callback([{target:rows[0],isIntersecting:true}]);assert.equal(demand.length,count);
}));

function catalogHarness(options={}){
  const media=[{id:'a',name:'Zulu.wav',has_audio:true,duration_frames:100,fps:{num:10,den:1},folder:'f'},{id:'b',name:'Alpha.mp4',has_video:true,duration_frames:50,fps:{num:10,den:1},folder:null},{id:'c',name:'Beta.mp4',has_video:true,duration_frames:200,fps:{num:20,den:1},folder:'f'}];
  const root=new Element('div'),state={selected:[],folder:'*'},commits=[],selection=[],opened=[],drags=[],ends=[];
  const panel=renderCatalog(root,{project_epoch:'epoch',media,folders:[{id:'f',name:'Folder',parent:null}]},state,{writable:true,assets:new Map(),commit:async operation=>commits.push(operation),getFiles:async()=>[],notice:assert.fail,onSelection:(id,ids,intent)=>selection.push({id,ids,...intent}),onOpen:id=>opened.push(id),onDragStart:(event,items)=>drags.push({event,items}),onDragEnd:event=>ends.push(event),intersectionObserver:null,...options});
  return {media,root,state,commits,selection,opened,drags,ends,panel,rows:()=>root.querySelectorAll('.media-item'),button:label=>root.querySelectorAll('button').find(node=>node.textContent===label || node.attrs['aria-label']===label),field:label=>root.querySelectorAll('select').find(node=>node.attrs['aria-label']===label)};
}

test('sortable headers preserve selection and Source intent while Shift keyboard ranges and batch order follow the newly drawn rows',async()=>withCatalogDom(async()=>{
  const h=catalogHarness();try{
    assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['b','c','a']);h.rows()[0].fire('click');const events=h.selection.length;
    h.button('Sort media by duration').fire('click');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['b','c','a']);
    h.button('Sort media by duration').fire('click');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['a','c','b']);assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.anchor,'b');assert.equal(h.selection.length,events);assert.deepEqual(h.opened,[]);assert.deepEqual(h.commits,[]);
    const list=h.root.querySelectorAll('.catalog-rows')[0];list.fire('keydown',{key:'ArrowUp',shiftKey:true,target:h.rows()[2]});assert.deepEqual(h.state.selected,['c','b']);assert.deepEqual(h.panel.selectedItems(),[h.media[2],h.media[1]]);
    h.rows()[0].fire('click',{shiftKey:true});assert.deepEqual(h.state.selected,['a','c','b']);assert.equal(h.state.anchor,'b');
    assert.equal(h.button('Sort media by duration').dataset.sortDirection,'descending');assert.equal(h.button('Sort media by duration').attrs['aria-pressed'],'true');
  }finally{h.panel.dispose();}
}));

test('search and folder/type filters prune invisible action targets and invalidate previously rendered Relink submissions',async()=>withCatalogDom(async()=>{
  const h=catalogHarness({getFiles:async()=>[{name:'replacement.wav',path_token:'replacement.wav'}]});try{
    h.root.querySelectorAll('.catalog-rows')[0].fire('keydown',{key:'a',ctrlKey:true});h.button('Relink selected media').fire('click');for(let index=0;index<5;index++)await Promise.resolve();
    const form=h.root.querySelectorAll('.catalog-relink-form')[0],oldSubmit=form.onsubmit;assert.equal(typeof oldSubmit,'function');
    h.panel.search(' ALPHA ');assert.deepEqual(h.state.selected,['b']);assert.deepEqual(h.panel.selectedItems(),[h.media[1]]);assert.equal(form.children.length,0);oldSubmit({preventDefault(){}});assert.equal(h.commits.length,0);
    h.button('Remove selected from project').fire('click');assert.deepEqual(h.commits[0],{kind:'edit_catalog',edit:{kind:'remove_media',media_ids:['b']}});
    h.panel.search('');h.field('Media folder').value='f';h.field('Media folder').fire('change');assert.deepEqual(h.state.selected,[]);assert.equal(h.button('Remove selected from project').disabled,true);h.button('Remove selected from project').fire('click');assert.equal(h.commits.length,1);
    h.rows()[0].fire('click');assert.deepEqual(h.state.selected,['c']);h.field('Media type').value='audio';h.field('Media type').fire('change');assert.deepEqual(h.state.selected,[]);assert.equal(h.state.anchor,null);assert.deepEqual(h.panel.selectedItems(),[]);
  }finally{h.panel.dispose();}
}));

test('native pool drags use the full chosen set in panel order and an unselected row replaces selection before callback',async()=>withCatalogDom(async()=>{
  const h=catalogHarness();try{
    h.rows()[2].fire('click');h.rows()[0].fire('click',{ctrlKey:true});assert.deepEqual(h.state.selected,['a','b']);const events=h.selection.length;
    const transfer={types:['protected']},start=h.rows()[2].fire('dragstart',{dataTransfer:transfer});assert.equal(h.drags.length,1);assert.equal(h.drags[0].event,start);assert.equal(h.drags[0].event.dataTransfer,transfer);assert.deepEqual(h.drags[0].items,[h.media[1],h.media[0]]);assert.equal(h.selection.length,events);assert.equal(start.defaultPrevented,undefined);
    h.rows()[2].fire('dragend');assert.equal(h.ends.length,1);
    h.rows()[1].fire('dragstart');assert.deepEqual(h.state.selected,['c']);assert.equal(h.state.anchor,'c');assert.deepEqual(h.drags[1].items,[h.media[2]]);assert.equal(h.selection.at(-1).userIntent,true);assert.deepEqual(h.commits,[]);assert.deepEqual(h.opened,[]);
    const old=h.rows()[1];h.panel.search('Alpha');old.fire('dragstart');assert.equal(h.drags.length,2,'detached row callbacks cannot publish stale media');
  }finally{h.panel.dispose();}
  const readonly=catalogHarness({writable:false});try{assert.ok(readonly.rows().every(row=>row.draggable===false));const event=readonly.rows()[0].fire('dragstart');assert.equal(event.defaultPrevented,true);assert.deepEqual(readonly.drags,[]);}finally{readonly.panel.dispose();}
}));

test('a late file-list read cannot reconstruct hidden Relink targets after search changes or catalog disposal',async()=>withCatalogDom(async()=>{
  for(const action of ['search','dispose']){
    let resolve;const h=catalogHarness({getFiles:()=>new Promise(done=>resolve=done)});h.rows()[0].fire('click');h.button('Relink selected media').fire('click');
    if(action==='search')h.panel.search('Zulu');else h.panel.dispose();resolve([{name:'replacement.mp4',path_token:'replacement.mp4'}]);for(let index=0;index<5;index++)await Promise.resolve();
    assert.equal(h.root.querySelectorAll('.catalog-relink-form')[0].children.length,0);assert.deepEqual(h.commits,[]);h.panel.dispose();
  }
}));

test('prepared Relink delegation receives visible selected IDs or the exact project folder without using the legacy probing route',async()=>withCatalogDom(async()=>{
  const scopes=[],h=catalogHarness({onRelink:scope=>scopes.push(scope),getFiles:()=>assert.fail('The prepared UI must not enumerate flat replacements')});try{
    h.rows()[0].fire('click');h.rows()[1].fire('click',{ctrlKey:true});h.button('Relink selected media').fire('click');assert.deepEqual(scopes,[{kind:'selected',media_ids:['b','c']}]);assert.deepEqual(h.commits,[]);
    h.field('Media folder').value='f';h.field('Media folder').fire('change');h.button('Relink current project folder').fire('click');assert.deepEqual(scopes[1],{kind:'folder',folder_id:'f'});assert.deepEqual(h.commits,[]);
  }finally{h.panel.dispose();}
}));
