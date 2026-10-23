import test from "node:test";
import assert from "node:assert/strict";
import {folderPaths, mediaSelection,visibleMediaDemand,mediaRowInfo,renderCatalog,compareMediaNames,sortMediaItems,catalogRows} from "../js/catalog.js";
import {CATALOG_DRAG_TYPE,makeCatalogDrag} from '../js/catalog-interactions.js';

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
  assert.equal(mediaRowInfo({has_video:true,has_audio:true,width:1920,height:1080,duration_frames:100,fps:{num:25,den:1}}).metadata,'Video · 1920×1080 · Audio · 25 fps');
  assert.equal(mediaRowInfo({has_audio:true,sample_rate:48000,channels:6}).metadata,'Audio · 48000 Hz · 6 channels');
  for(const fps of [undefined,{num:0,den:1},{num:24,den:0}])assert.equal(mediaRowInfo({has_video:true,duration_frames:100,fps}).duration,"—");
});

class Element {
    constructor(tag){this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className="";this.textContent="";this.connected=true;this.ownerDocument=globalThis.document;this.captured=new Set();this.bounds={left:10,top:20,right:330,bottom:240,width:320,height:220};
      this.style={setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(" ").filter(Boolean));if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(" ");}};}
    append(...nodes){for(const node of nodes){node.parentElement=this;node.connected=true;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children){child.parentElement=null;child.connected=false;}this.children=[];this.append(...nodes);}
    insertBefore(node,before){node.parentElement=this;node.connected=true;this.children.splice(this.children.indexOf(before),0,node);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;this.connected=false;}
    setAttribute(key,value){this.attrs[key]=String(value);}
    getAttribute(key){return this.attrs[key];}get isConnected(){return this.connected && (!this.parentElement || this.parentElement.isConnected);}
    addEventListener(type,callback,capture=false){(this.listeners[type]??=[]).push({callback,capture:typeof capture==='boolean'?capture:Boolean(capture.capture)});}
    removeEventListener(type,callback){this.listeners[type]=(this.listeners[type] || []).filter(row=>row.callback!==callback);}
    fire(type,values={}){const event={type,target:this,button:0,pointerId:1,clientX:15,clientY:25,detail:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediate=true;this.stopped=true;},...values};for(const {callback} of [...(this.listeners[type] || [])].sort((a,b)=>Number(b.capture)-Number(a.capture))){callback(event);if(event.immediate)break;}return event;}
    get options(){return this.children;}
    getBoundingClientRect(){return {...this.bounds};}contains(node){while(node){if(node===this)return true;node=node.parentElement;}return false;}
    setPointerCapture(pointer){this.captured.add(pointer);}hasPointerCapture(pointer){return this.captured.has(pointer);}releasePointerCapture(pointer){this.captured.delete(pointer);this.fire('lostpointercapture',{pointerId:pointer});}
    focus(){globalThis.document.activeElement=this;}
    select(){this.textSelected=true;}click(){if(!this.disabled)this.fire('click');}reportValidity(){return true;}
    matches(selector){return selector.split(',').some(part=>{part=part.trim();return part.startsWith('.')?this.className.split(' ').includes(part.slice(1)):part==='dialog[open]'?this.tag==='dialog' && this.open:part.startsWith('[')?Object.hasOwn(this.attrs,part.slice(1,-1)) || part==='[tabindex]' && Number.isFinite(this.tabIndex):this.tag===part;});}
    closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentElement;}return null;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
}
async function withCatalogDom(run){
  const previous={document:globalThis.document,Option:globalThis.Option};
  const doc=new Element('document'),window=new Element('window');window.innerWidth=1280;window.innerHeight=720;doc.defaultView=window;doc.hidden=false;doc.createElement=tag=>{const node=new Element(tag);node.ownerDocument=doc;return node;};globalThis.document=doc;doc.body=doc.createElement('body');doc.append(doc.body);doc.activeElement=doc.body;
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

function catalogHarness(options={},initial={}){
  const media=initial.media || [{id:'a',name:'Zulu.wav',has_audio:true,duration_frames:100,fps:{num:10,den:1},folder:'f'},{id:'b',name:'Alpha.mp4',has_video:true,duration_frames:50,fps:{num:10,den:1},folder:null},{id:'c',name:'Beta.mp4',has_video:true,duration_frames:200,fps:{num:20,den:1},folder:'f'}];
  const root=new Element('div'),state={selected:[],folder:'*',expanded:['f'],...initial.state},commits=[],selection=[],opened=[],drags=[],ends=[],actions=[];document.body.append(root);
  let documentState={project_epoch:'epoch',generation:'0',media,folders:initial.folders || [{id:'f',name:'Folder',parent:null}]},panel;
  const configuration={writable:true,assets:new Map(),getFiles:async()=>[],notice:assert.fail,onSelection:(id,ids,intent)=>selection.push({id,ids,...intent}),onOpen:id=>opened.push(id),onDragStart:(event,items)=>drags.push({event,items}),onDragEnd:event=>ends.push(event),intersectionObserver:null,...options,commit:async operation=>{commits.push(operation);return options.commit?.(operation);},onAction:action=>{actions.push(action);return options.onAction?.(action);}};
  const render=()=>panel=renderCatalog(root,documentState,state,configuration);render();
  return {media,root,state,commits,selection,opened,drags,ends,actions,get panel(){return panel;},get documentState(){return documentState;},rerender(next){panel.dispose();documentState=next;return render();},rows:()=>root.querySelectorAll('.media-item'),row:id=>root.querySelectorAll('.media-item').find(row=>row.dataset.mediaId===id),folder:id=>root.querySelectorAll('.catalog-folder-row').find(row=>row.dataset.folderId===id),button:label=>root.querySelectorAll('button').find(node=>node.textContent===label || node.attrs['aria-label']===label),field:label=>root.querySelectorAll('select').find(node=>node.attrs['aria-label']===label)};
}

function catalogTransfer(initial=[]){const data=new Map(initial.map(type=>[type,'protected']));return {get types(){return [...data.keys()];},setData(type,value){data.set(type,value);},getData:type=>data.get(type) || ''};}
const settleCatalog=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
const menuButton=label=>{const menu=document.body.querySelectorAll('.catalog-context-menu')[0];assert.ok(menu,'context menu');const node=menu.querySelectorAll('button').find(node=>node.textContent===label);assert.ok(node,label);return node;};

test('sortable headers preserve selection and Source intent while Shift keyboard ranges and batch order follow the newly drawn rows',async()=>withCatalogDom(async()=>{
  const h=catalogHarness();try{
    assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['c','a','b']);h.row('b').fire('click');const events=h.selection.length;
    h.button('Sort media by duration').fire('click');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['c','a','b']);
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
    h.row('a').fire('click');h.row('b').fire('click',{ctrlKey:true});assert.deepEqual(h.state.selected,['a','b']);const events=h.selection.length;
    const transfer=catalogTransfer(['protected']),start=h.row('a').fire('dragstart',{dataTransfer:transfer});assert.equal(h.drags.length,1);assert.equal(h.drags[0].event,start);assert.equal(h.drags[0].event.dataTransfer,transfer);assert.deepEqual(h.drags[0].items,[h.media[0],h.media[1]]);assert.equal(h.selection.length,events);assert.equal(start.defaultPrevented,undefined);
    h.row('a').fire('dragend');assert.equal(h.ends.length,1);
    h.row('c').fire('dragstart');assert.deepEqual(h.state.selected,['c']);assert.equal(h.state.anchor,'c');assert.deepEqual(h.drags[1].items,[h.media[2]]);assert.equal(h.selection.at(-1).userIntent,true);assert.deepEqual(h.commits,[]);assert.deepEqual(h.opened,[]);
    const old=h.row('c');h.panel.search('Alpha');old.fire('dragstart');assert.equal(h.drags.length,2,'detached row callbacks cannot publish stale media');
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
    h.row('b').fire('click');h.row('c').fire('click',{ctrlKey:true});h.button('Relink selected media').fire('click');assert.deepEqual(scopes,[{kind:'selected',media_ids:['c','b']}]);assert.deepEqual(h.commits,[]);
    h.field('Media folder').value='f';h.field('Media folder').fire('change');h.button('Relink current project folder').fire('click');assert.deepEqual(scopes[1],{kind:'folder',folder_id:'f'});assert.deepEqual(h.commits,[]);
  }finally{h.panel.dispose();}
}));

test('native folder presentation is folder-first, expansion-bounded and search-revealed, while Grid uses immediate children',()=>{
  const folders=[{id:'z',name:'Zulu',parent:null},{id:'a',name:'Alpha',parent:null},{id:'child',name:'Nested',parent:'a'},{id:'orphan',name:'Orphan',parent:'gone'}];
  const items=[{id:'root',name:'Root'},{id:'deep',name:'Deep',folder:'child'},{id:'direct',name:'Direct',folder:'a'},{id:'missing',name:'Missing',folder:'gone'}];
  const row=value=>value.kind==='folder'?`folder:${value.folder.id}:${value.depth}`:`media:${value.item.id}:${value.depth}`;
  assert.deepEqual(catalogRows(items,folders).map(row),['folder:a:0','folder:orphan:0','folder:z:0','media:root:0','media:missing:0']);
  assert.deepEqual(catalogRows(items,folders,{expanded:['a','child']}).map(row),['folder:a:0','folder:child:1','media:deep:2','media:direct:1','folder:orphan:0','folder:z:0','media:root:0','media:missing:0']);
  const expanded=[];assert.deepEqual(catalogRows([items[1]],folders,{query:'deep',expanded}).map(row),['folder:a:0','folder:child:1','media:deep:2']);assert.deepEqual(expanded,[],'search reveal does not replace saved expansion');
  assert.deepEqual(catalogRows(items,folders,{layout:'grid',gridFolder:'a'}).map(row),['folder:child:0','media:direct:0']);
  assert.deepEqual(catalogRows([items[1]],folders,{layout:'grid',gridFolder:'a',query:'deep'}).map(row),['media:deep:0']);
  assert.deepEqual(catalogRows(items,folders,{folder:'a'}).map(row),items.map(item=>`media:${item.id}:0`),'explicit Web folder/type filtering is applied before the presentation helper');
  assert.equal(catalogRows([],[{id:'cycle',name:'Cycle',parent:'cycle'}],{expanded:['cycle']}).length,0,'malformed cycles cannot recurse');
});

test('layout controls create real native Details, dense List and browsable Grid presentations without project writes or hidden derivative demand',async()=>withCatalogDom(async()=>{
  let observer;class Observer{constructor(callback){observer=this;this.callback=callback;this.rows=[];}observe(row){this.rows.push(row);}disconnect(){this.rows=[];}}
  const demand=[],presentation=[],h=catalogHarness({assets:new Map([['thumb',{mediaId:'b',thumbnail:{},thumbnailURL:'blob:verified'}]]),intersectionObserver:Observer,onDemand:items=>demand.push(items),onPresentationChange:value=>presentation.push(value)});try{
    assert.equal(h.state.layout,'details');assert.equal(h.root.dataset.layout,'details');assert.equal(h.row('b').children[0].children[0].src,'blob:verified');assert.equal(h.row('b').children[1].children[1].hidden,false);
    h.row('b').fire('click');const events=h.selection.length;h.button('Show media list view').fire('click');assert.equal(h.root.dataset.layout,'list');assert.equal(h.row('b').children[0].children.length,0);assert.equal(h.row('b').children[1].children[1].hidden,true);assert.deepEqual(observer.rows,[]);assert.deepEqual(demand.at(-1),[]);assert.deepEqual(h.state.selected,['b']);assert.equal(h.selection.length,events);
    h.button('Show media details view').fire('click');assert.ok(observer.rows.some(row=>row.dataset.mediaId==='b'));observer.callback([{target:h.row('b'),isIntersecting:true}]);assert.equal(demand.at(-1)[0].media_id,'b');
    h.button('Show media grid view').fire('click');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['b']);assert.equal(h.row('b').children[2].hidden,true);assert.equal(h.row('b').children[1].children[1].hidden,true);
    const folder=h.button('Select project folder Folder');folder.fire('click');folder.fire('dblclick');assert.equal(h.state.gridFolder,'f');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['c','a']);assert.deepEqual(h.state.selected,[],'navigation prunes invisible mutation targets');assert.equal(h.root.querySelectorAll('.catalog-breadcrumbs')[0].hidden,false);
    h.button('Project media root').fire('click');assert.equal(h.state.gridFolder,null);assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['b']);assert.deepEqual(h.commits,[]);assert.deepEqual(h.opened,[]);assert.deepEqual(presentation.map(value=>value.layout),['list','details','grid']);presentation[0].expanded.push('foreign');assert.equal(h.state.expanded.includes('foreign'),false);
  }finally{h.panel.dispose();}
}));

test('folder arrows preserve selection, labels select only the folder, and collapsing/searching cannot leave invisible media as command targets',async()=>withCatalogDom(async()=>{
  const scopes=[],h=catalogHarness({onRelink:scope=>scopes.push(scope)},{state:{expanded:[]}});try{
    assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['b']);h.row('b').fire('click');const events=h.selection.length;h.button('Expand folder Folder').fire('click');assert.deepEqual(h.state.selected,['b']);assert.equal(h.selection.length,events);assert.equal(h.state.selectedFolder,null);assert.deepEqual(h.state.expanded,['f']);
    h.row('c').fire('click',{shiftKey:true,ctrlKey:true});assert.deepEqual(h.state.selected,['c','a','b']);h.button('Collapse folder Folder').fire('click');assert.deepEqual(h.state.selected,['b']);assert.deepEqual(h.panel.selectedItems().map(item=>item.id),['b']);h.button('Remove selected from project').fire('click');assert.deepEqual(h.commits[0].edit.media_ids,['b']);
    h.panel.search('Zulu');assert.deepEqual(h.rows().map(row=>row.dataset.mediaId),['a']);assert.deepEqual(h.state.expanded,[],'search opens ancestors without altering user expansion');assert.equal(h.root.querySelectorAll('.catalog-folder-row')[0].dataset.depth,'0');assert.equal(h.row('a').dataset.depth,'1');assert.deepEqual(h.state.selected,[]);
    h.panel.search('');h.button('Select project folder Folder').fire('click');assert.equal(h.state.selectedFolder,'f');assert.deepEqual(h.state.selected,[]);assert.equal(h.state.anchor,null);h.button('Relink current project folder').fire('click');assert.deepEqual(scopes,[{kind:'folder',folder_id:'f'}]);assert.equal(h.button('Remove selected from project').disabled,true);
    h.panel.search('Alpha');assert.equal(h.state.selectedFolder,null);assert.equal(h.button('Relink current project folder').disabled,true);h.panel.search('');
    const list=h.root.querySelectorAll('.catalog-rows')[0];list.fire('keydown',{target:h.button('Select project folder Folder'),key:'a',ctrlKey:true});assert.deepEqual(h.state.selected,['c','a','b']);assert.equal(h.state.selectedFolder,null);h.row('c').fire('dblclick');list.fire('keydown',{target:h.row('a'),key:'Enter'});assert.deepEqual(h.opened,['c','a']);
  }finally{h.panel.dispose();}
}));

test('explicit successful-import reveal expands tree ancestors while Grid enters the final item folder and retains only visible requested IDs',async()=>withCatalogDom(async()=>{
  const h=catalogHarness({},{state:{expanded:[],query:'not found',kind:'video'}});try{
    h.panel.reveal(['a','b','missing','a']);assert.deepEqual(h.state.selected,['a','b']);assert.deepEqual(h.state.expanded,['f']);assert.equal(h.state.query,'');assert.equal(h.state.kind,'all');assert.equal(h.state.folder,'*');assert.deepEqual(h.panel.selectedItems().map(item=>item.id),['a','b']);assert.deepEqual(h.commits,[]);assert.deepEqual(h.opened,[]);
    h.button('Show media grid view').fire('click');h.panel.reveal(['a','b']);assert.equal(h.state.gridFolder,null);assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.anchor,'b');h.panel.reveal(['b','a']);assert.equal(h.state.gridFolder,'f');assert.deepEqual(h.state.selected,['a']);assert.deepEqual(h.panel.selectedItems().map(item=>item.id),['a']);
    h.row('a').fire('dragstart');assert.deepEqual(h.drags.at(-1).items.map(item=>item.id),['a']);h.panel.dispose();h.panel.reveal(['b']);assert.deepEqual(h.state.selected,['a']);
  }finally{h.panel.dispose();}
}));

test('native name column separator has bounded local pointer/keyboard sizing, cancellation and reset without changing media selection or Source',async()=>withCatalogDom(async()=>{
  const h=catalogHarness(),divider=h.root.querySelectorAll('.catalog-name-divider')[0],header=h.root.querySelectorAll('.catalog-sort-header')[0];header.getBoundingClientRect=()=>({width:320});try{
    h.row('b').fire('click');const events=h.selection.length;divider.fire('keydown',{key:'ArrowLeft'});assert.equal(h.state.nameWidth,242);divider.fire('keydown',{key:'ArrowLeft',shiftKey:true});assert.equal(h.state.nameWidth,241);
    divider.fire('pointerdown',{button:0,pointerId:1,clientX:241});divider.fire('pointermove',{pointerId:1,clientX:10000});assert.equal(h.state.nameWidth,250);divider.fire('keydown',{key:'Escape'});assert.equal(h.state.nameWidth,241);divider.fire('pointerup',{pointerId:1,clientX:80});assert.equal(h.state.nameWidth,241,'canceled release cannot replay the draft');
    divider.fire('pointerdown',{button:0,pointerId:2,clientX:241});divider.fire('pointermove',{pointerId:2,clientX:150});divider.fire('pointerup',{pointerId:2,clientX:120});assert.equal(h.state.nameWidth,120,'release samples final pointer coordinates');divider.fire('dblclick');assert.equal(h.state.nameWidth,null);divider.fire('keydown',{key:'ArrowLeft'});divider.fire('keydown',{key:'Home'});assert.equal(h.state.nameWidth,null);
    divider.fire('pointerdown',{button:0,pointerId:3,clientX:250});divider.fire('pointermove',{pointerId:3,clientX:180});header.getBoundingClientRect=()=>({width:210});divider.fire('pointermove',{pointerId:3,clientX:170});assert.equal(h.state.nameWidth,null,'viewport change restores automatic sizing');assert.deepEqual(h.state.selected,['b']);assert.equal(h.selection.length,events);assert.deepEqual(h.commits,[]);assert.deepEqual(h.opened,[]);
  }finally{h.panel.dispose();}
}));

test('native context menus select an outside media row, preserve an existing group and target an unselected folder without changing selection',async()=>withCatalogDom(async()=>{
  const scopes=[],h=catalogHarness({onRelink:scope=>scopes.push(scope)});try{
    h.row('c').fire('click');h.row('a').fire('click',{ctrlKey:true});const events=h.selection.length;
    h.root.fire('contextmenu',{target:h.row('c')});assert.deepEqual(h.state.selected,['c','a']);assert.equal(h.selection.length,events);menuButton('Relink 2 selected media').click();await settleCatalog();assert.deepEqual(scopes[0],{kind:'selected',media_ids:['c','a']});
    h.root.fire('contextmenu',{target:h.row('b')});assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.anchor,'b');menuButton('Relink media').click();await settleCatalog();assert.deepEqual(scopes[1],{kind:'selected',media_ids:['b']});
    h.root.fire('contextmenu',{target:h.folder('f')});assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.selectedFolder,null);menuButton('Relink folder').click();await settleCatalog();assert.deepEqual(scopes[2],{kind:'folder',folder_id:'f'});assert.deepEqual(h.commits,[]);
  }finally{h.panel.dispose();}
}));

test('folder drag preserves media selection while media drag publishes both trusted catalog and existing timeline payloads in panel order',async()=>withCatalogDom(async()=>{
  const timelineType='application/x-venturi-project-media',hook=[],h=catalogHarness({onDragStart:(event,items,options)=>{hook.push({items,options});event.dataTransfer.setData(timelineType,'trusted-timeline-token');}});try{
    h.row('b').fire('click');const events=h.selection.length,folderTransfer=catalogTransfer();h.folder('f').fire('dragstart',{dataTransfer:folderTransfer});assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.selectedFolder,null);assert.equal(h.selection.length,events);assert.deepEqual(JSON.parse(folderTransfer.getData(CATALOG_DRAG_TYPE)),{version:1,kind:'folder',project_epoch:'epoch',generation:'0',folder_id:'f',source_parent:null});assert.equal(hook.length,0);h.folder('f').fire('dragend');
    h.row('a').fire('click',{ctrlKey:true});const mediaTransfer=catalogTransfer();h.row('a').fire('dragstart',{dataTransfer:mediaTransfer});assert.deepEqual(hook[0].items.map(item=>item.id),['a','b']);assert.deepEqual(hook[0].options,{catalogFallback:true});assert.deepEqual(JSON.parse(mediaTransfer.getData(CATALOG_DRAG_TYPE)).media_ids,['a','b']);assert.equal(mediaTransfer.getData(timelineType),'trusted-timeline-token');assert.equal(mediaTransfer.effectAllowed,'copyMove');assert.deepEqual(h.commits,[]);
  }finally{h.panel.dispose();}
}));

test('native catalog drops move once and reconcile the first dragged anchor through generation refresh, while same-folder drops remain real no-ops',async()=>withCatalogDom(async()=>{
  let h;h=catalogHarness({commit:operation=>{
    assert.equal(operation.edit.kind,'move_media');const next={...h.documentState,generation:String(BigInt(h.documentState.generation)+1n),media:h.documentState.media.map(item=>operation.edit.media_ids.includes(item.id)?{...item,folder:operation.edit.folder}:item)};h.rerender(next);const receipt={project_epoch:next.project_epoch,generation:next.generation};assert.equal(h.panel.acceptReceipt(receipt),true);return receipt;
  }},{folders:[{id:'f',name:'Folder',parent:null},{id:'g',name:'Target',parent:'f'}],state:{expanded:['f','g']}});
  const move=async target=>{const transfer=catalogTransfer(),source=h.row('c');source.fire('dragstart',{dataTransfer:transfer});h.root.fire('drop',{target:target(),dataTransfer:transfer});source.fire('dragend',{dataTransfer:transfer});await settleCatalog();};
  try{
    h.row('c').fire('click');h.row('a').fire('click',{ctrlKey:true});await move(()=>h.folder('g'));assert.deepEqual(h.commits[0],{kind:'edit_catalog',edit:{kind:'move_media',media_ids:['c','a'],folder:'g'}});assert.deepEqual(h.state.selected,['c','a']);assert.equal(h.state.anchor,'c');assert.equal(h.documentState.generation,'1');assert.equal(h.state.pendingCatalog,undefined);assert.deepEqual(h.panel.selectedItems().map(item=>item.id),['c','a']);
    await move(()=>h.row('a'));assert.equal(h.commits.length,1,'the raw media row resolves its containing folder, so this is a no-op');assert.equal(h.state.anchor,'c');
    await move(()=>h.row('b'));assert.equal(h.commits.length,2);assert.equal(h.commits[1].edit.folder,null);assert.equal(h.state.anchor,'c');
    await move(()=>h.folder('f'));assert.equal(h.commits.length,3);assert.equal(h.commits[2].edit.folder,'f');await move(()=>h.root.querySelectorAll('.catalog-rows')[0]);assert.equal(h.commits.length,4);assert.equal(h.commits[3].edit.folder,null);assert.deepEqual(h.state.selected,['c','a']);assert.equal(h.state.anchor,'c');await move(()=>h.root.querySelectorAll('.catalog-rows')[0]);assert.equal(h.commits.length,4);assert.deepEqual(h.opened,[]);
  }finally{h.panel.dispose();}
}));

test('an external generation and matching new folder cannot open rename or steal selection without the successful command receipt',async()=>withCatalogDom(async()=>{
  const h=catalogHarness();try{
    h.row('b').fire('click');h.state.pendingCatalog={kind:'new_folder',name:'New folder',parent:null,before:['f'],project_epoch:'epoch',generation:'0'};
    h.rerender({...h.documentState,generation:'1',folders:[...h.documentState.folders,{id:'external',name:'New folder',parent:null}]});assert.deepEqual(h.state.selected,['b']);assert.equal(h.state.anchor,'b');assert.equal(h.state.selectedFolder,null);assert.equal(document.body.querySelectorAll('.catalog-rename-input').length,0);assert.equal(h.panel.acceptReceipt({project_epoch:'foreign',generation:'1'}),false);assert.equal(document.body.querySelectorAll('.catalog-rename-input').length,0);
    assert.equal(h.panel.acceptReceipt({project_epoch:'epoch',generation:'1'}),true);assert.deepEqual(h.state.selected,[]);assert.equal(h.state.selectedFolder,'external');const input=document.body.querySelectorAll('.catalog-rename-input')[0];assert.ok(input);assert.equal(input.value,'New folder');input.fire('keydown',{key:'Escape'});assert.deepEqual(h.commits,[]);
  }finally{h.panel.dispose();}
}));

test('catalog drop refuses matching JSON without its live drag witness and rejects stale or foreign project payloads',async()=>withCatalogDom(async()=>{
  const notices=[],h=catalogHarness({notice:text=>notices.push(text)});try{
    const owner={project_epoch:'epoch',generation:'0',snapshot:h.documentState},foreign=catalogTransfer();foreign.setData(CATALOG_DRAG_TYPE,makeCatalogDrag('media',['b'],owner));h.root.fire('drop',{target:h.folder('f'),dataTransfer:foreign});await settleCatalog();assert.deepEqual(h.commits,[],'valid-looking JSON alone is not native drag ownership');
    const stale=catalogTransfer();h.row('b').fire('dragstart',{dataTransfer:stale});h.panel.search('Alpha');h.root.fire('drop',{target:h.root.querySelectorAll('.catalog-rows')[0],dataTransfer:stale});await settleCatalog();assert.deepEqual(h.commits,[],'presentation changes retire the root-owned source witness');
    h.panel.search('');const transfer=catalogTransfer();h.row('b').fire('dragstart',{dataTransfer:transfer});const payload=JSON.parse(transfer.getData(CATALOG_DRAG_TYPE));payload.project_epoch='foreign';transfer.setData(CATALOG_DRAG_TYPE,JSON.stringify(payload));h.root.fire('drop',{target:h.folder('f'),dataTransfer:transfer});await settleCatalog();assert.deepEqual(h.commits,[]);assert.match(notices.at(-1),/changed/);
  }finally{h.panel.dispose();}
}));

test('F2 preserves immutable file names but opens guarded folder/compound rename editors and dispatches each accepted native action once',async()=>withCatalogDom(async()=>{
  const h=catalogHarness({},{media:[{id:'file',name:'Original.mp4',has_video:true,duration_frames:24,fps:{num:24,den:1}},{id:'compound',name:'Sequence',compound_timeline_id:'timeline',has_video:true,duration_frames:24,fps:{num:24,den:1}}]});try{
    const list=h.root.querySelectorAll('.catalog-rows')[0];h.row('file').fire('click');list.fire('keydown',{target:h.row('file'),key:'F2'});assert.equal(document.body.querySelectorAll('.catalog-rename-input').length,0);assert.equal(h.media[0].name,'Original.mp4');
    h.row('compound').fire('click');list.fire('keydown',{target:h.row('compound'),key:'F2'});const input=document.body.querySelectorAll('.catalog-rename-input')[0];assert.ok(input);assert.equal(input.attrs['aria-label'],'Rename timeline');input.value='Renamed sequence';input.fire('keydown',{key:'Enter'});input.fire('blur');await settleCatalog();assert.deepEqual(h.actions,[{kind:'rename_timeline',media_id:'compound',timeline_id:'timeline',name:'Renamed sequence'}]);assert.deepEqual(h.commits,[]);
    h.button('Select project folder Folder').fire('click');list.fire('keydown',{target:list,key:'F2'});const folderInput=document.body.querySelectorAll('.catalog-rename-input')[0];assert.equal(folderInput.attrs['aria-label'],'Rename folder');folderInput.value='Folder renamed';folderInput.fire('keydown',{key:'Enter'});folderInput.fire('blur');await settleCatalog();assert.deepEqual(h.commits,[{kind:'edit_catalog',edit:{kind:'rename_folder',folder:'f',name:'Folder renamed'}}]);assert.equal(h.media[0].name,'Original.mp4');
  }finally{h.panel.dispose();}
}));

test('catalog-integrated marquee replaces the selected set at release, anchors its first visible hit and suppresses the trailing blank click',async()=>withCatalogDom(async()=>{
  const h=catalogHarness({writable:false});try{
    const list=h.root.querySelectorAll('.catalog-rows')[0];list.bounds={left:10,top:20,right:330,bottom:240,width:320,height:220};h.row('c').bounds={left:30,top:40,right:90,bottom:60,width:60,height:20};h.row('a').bounds={left:110,top:70,right:180,bottom:90,width:70,height:20};h.row('b').bounds={left:200,top:140,right:270,bottom:160,width:70,height:20};h.row('b').fire('click');const events=h.selection.length;
    list.fire('pointerdown',{ctrlKey:true,shiftKey:true});document.fire('pointermove',{target:list,clientX:115,clientY:75});assert.deepEqual(h.state.selected,['b']);assert.equal(h.selection.length,events);document.fire('pointerup',{target:list,clientX:115,clientY:75});assert.deepEqual(h.state.selected,['c','a']);assert.equal(h.state.anchor,'c');assert.equal(h.selection.length,events+1);list.fire('click');assert.deepEqual(h.state.selected,['c','a']);assert.deepEqual(h.commits,[]);
    list.fire('pointerdown');document.fire('pointermove',{target:list,clientX:220,clientY:150});document.fire('keydown',{target:list,key:'Escape'});document.fire('pointerup',{target:list,clientX:220,clientY:150});assert.deepEqual(h.state.selected,['c','a']);assert.equal(h.state.anchor,'c');assert.equal(h.selection.length,events+1);
  }finally{h.panel.dispose();}
}));
