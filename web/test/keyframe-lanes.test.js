import test from 'node:test';
import assert from 'node:assert/strict';
import {animatedKeyRows,laneBoxPicks,laneDragDelta,renderKeyframeLanes,KEYFRAME_ROW_HEIGHT} from '../js/keyframe-lanes.js';
import {createKeyPickSelection,pointerKeyOperation} from '../js/curves.js';

const transform={kind:'transform',param:'PositionX'},text={kind:'text'},color={kind:'color'};
const row=(name,target,frames=[20,30,39])=>({name,target,key_count:frames.length,keys:frames.map(source_frame=>({source_frame,timeline_frame:400+(source_frame-20)*3/2,value:source_frame,interpolation:'Hold'}))});
const detail=()=>({clip_id:'9007199254740993',project_epoch:'epoch',generation:'7',timeline_id:'2',revision:'native-revision',
  keyframe_clock:{source_frame:30,source_in:20,source_out:40,ticks:[]},
  curves:{source_start:20,source_end:39,tracks:[row('Position X',transform)]},event_keys:[row('Color',color),row('Text',text)],key_page:{index:0,total_pages:1,page_size:256}});
const axis={left:110,plotWidth:180,range:{source_start:20,source_end:40},x:frame=>110+(frame-20)*9};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('native animated lanes combine scalar and typed rows in native filter order, including off-page rows',()=>{
  const value=detail();
  value.curves.tracks.push(row('Constant',{kind:'transform',param:'PositionY'},[]),row('Radius',{kind:'filter_radius',filter:'DirectionalBlur'}),row('Amount',{kind:'filter_amount',filter:'Exposure'}),row('Mask',{kind:'mask',index:0,param:'CenterX'}));
  value.event_keys.push(row('Direction',{kind:'direction',filter:'DirectionalBlur'}));
  value.filters={stack:[{kind:'DirectionalBlur'},{kind:'Exposure'}]};
  value.event_keys[0].keys=[];value.event_keys[0].key_count=600;
  assert.deepEqual(animatedKeyRows(value).map(item=>item.name),['Position X','Color','Radius','Direction','Amount','Mask','Text']);
  assert.equal(animatedKeyRows(value)[1].key_count,600);
  assert.deepEqual(value.curves.tracks[1].keys,[]);
});

test('lane marquee uses the shared source axis and row centers, clips labels and retains scrolled row identity',()=>{
  const rows=animatedKeyRows(detail());
  assert.deepEqual(laneBoxPicks(rows,axis,{x0:195,x1:205,y0:0,y1:66}).map(pick=>pick.target),[transform,color,text]);
  assert.deepEqual(laneBoxPicks(rows,axis,{x0:205,x1:195,y0:22,y1:0},22),[{target:color,source_frame:30}]);
  assert.deepEqual(laneBoxPicks(rows,axis,{x0:0,x1:109,y0:0,y1:100}),[]);
  assert.deepEqual(laneBoxPicks(rows,axis,{x0:195,x1:205,y0:12,y1:32}),[]);
});

test('lane time drag clamps every selected native key, uses source frames rather than FPS, and rounds both grabbed positions',()=>{
  const picks=[{target:transform,source_frame:25},{target:text,source_frame:35}],range={source_start:20,source_end:39};
  assert.equal(laneDragDelta(picks,range,axis,150,300),4);
  assert.equal(laneDragDelta(picks,range,axis,150,0),-5);
  assert.equal(laneDragDelta(picks,range,axis,150,159),1);
  assert.equal(laneDragDelta(picks,range,axis,150,150),0);
  const fractional={...axis,plotWidth:7,range:{source_start:0,source_end:7}};
  assert.equal(laneDragDelta([{target:text,source_frame:3}],{source_start:0,source_end:7},fractional,110,109.5),-1);
});

class Element {
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.listeners=new Map();this.style={};this.attributes={};this.scrollTop=0;this.isConnected=true;this.captures=new Set();this.rect={left:0,top:0,width:300};this.calls=[];}
  append(...children){for(const child of children){this.children.push(child);child.parentNode=this;}}
  remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,callback){const values=this.listeners.get(type) || [];values.push(callback);this.listeners.set(type,values);}
  removeEventListener(type,callback){this.listeners.set(type,(this.listeners.get(type) || []).filter(value=>value!==callback));}
  emit(type,values={}){const event={type,pointerId:1,button:0,buttons:1,clientX:0,clientY:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...values};for(const callback of this.listeners.get(type) || [])callback(event);return event;}
  getBoundingClientRect(){return {...this.rect,height:Number.parseFloat(this.style.height) || 100};}
  getContext(){return this.ctx ??= new Proxy({}, {get:(target,key)=>target[key] ?? ((...args)=>this.calls.push([key,...args]))});}
  focus(){this.ownerDocument.activeElement=this;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id});}
}

function harness({editable=true,commit,value=detail(),selection=createKeyPickSelection(),range={source_start:20,source_end:40}}={}){
  const document=new Element('document');document.hidden=false;document.modal=false;document.querySelector=()=>document.modal?{}:null;
  document.createElement=tag=>new Element(tag,document);
  const window=new Element('window',document);window.devicePixelRatio=1;window.getComputedStyle=()=>({getPropertyValue:()=>''});window.ResizeObserver=class{observe(){}disconnect(){}};document.defaultView=window;
  const root=new Element('section',document),commands=[],notices=[],targets=[],seeks=[];let current=true,canEdit=editable;
  const control=renderKeyframeLanes(root,value,{keySelection:selection,getGeometry:()=>({...axis,plotWidth:178}),getRange:()=>range,canNavigate:()=>current,canEdit:()=>canEdit,
    commit:payload=>{commands.push(payload);return commit?.(payload);},operation:(picks,delta,linked)=>pointerKeyOperation(value.clip_id,picks,delta,null,linked),activate:target=>targets.push(target),notice:message=>notices.push(message),seek:frame=>seeks.push(frame),windowRef:window});
  const all=node=>[node,...node.children.flatMap(all)],nodes=all(root),canvas=nodes.find(node=>node.tagName==='canvas'),viewport=nodes.find(node=>node.className==='keyframe-lanes-viewport'),status=nodes.find(node=>node.attributes['aria-live']);
  return {root,document,window,control,commands,notices,targets,seeks,selection,canvas,viewport,status,value,setCurrent:value=>current=value,setEditable:value=>canEdit=value};
}

test('actual mixed-row marquee followed by time drag sends one complete native operation on release',async()=>{
  const h=harness(),initial=structuredClone(detail());
  h.canvas.emit('pointerdown',{clientX:185,clientY:1});h.canvas.emit('pointermove',{clientX:205,clientY:65});
  assert.equal(h.commands.length,0);h.canvas.emit('pointerup',{clientX:205,clientY:65});
  assert.deepEqual(h.selection.get(),[transform,color,text].map(target=>({target,source_frame:30})));
  h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointermove',{clientX:217,clientY:11});
  assert.equal(h.commands.length,0);h.canvas.emit('pointerup',{clientX:217,clientY:11});h.canvas.emit('pointerup',{clientX:217,clientY:11});await settle();
  assert.equal(h.commands.length,1);
  assert.deepEqual(h.commands[0],pointerKeyOperation(initial.clip_id,[transform,color,text].map(target=>({target,source_frame:30})),2));
  assert.deepEqual(h.selection.get().map(pick=>pick.source_frame),[32,32,32]);assert.equal(h.canvas.captures.size,0);
  assert.deepEqual(h.value,initial);h.control.dispose();
});

test('plain lane click collapses a mixed selection only on owned unmoved release before Delete',async()=>{
  const a={target:transform,source_frame:30},b={target:text,source_frame:30},h=harness();try{
    h.selection.set([a,b]);h.canvas.emit('pointerdown',{clientX:199,clientY:11});assert.deepEqual(h.selection.get(),[a,b],'A possible group drag retains peers');
    h.canvas.emit('pointerup',{pointerId:2,clientX:199,clientY:11});assert.deepEqual(h.selection.get(),[a,b]);h.canvas.emit('pointerup',{clientX:199,clientY:11});assert.deepEqual(h.selection.get(),[a]);assert.equal(h.commands.length,0);
    h.canvas.emit('pointerup',{clientX:199,clientY:11});h.canvas.emit('keydown',{key:'Delete'});await settle();assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit.picks,[a]);assert.deepEqual(h.commands[0].edit.action,{kind:'delete'});
  }finally{h.control.dispose();}
});

test('dense lane clicks resolve the key at release and never retain a different press hit in additive or readonly selection',()=>{
  for(const editable of [true,false]){
    const value=detail();value.curves.tracks=[row('Position X',transform,[30,31])];const h=harness({editable,value,range:{source_start:20,source_end:220}}),previous={target:text,source_frame:30},released={target:transform,source_frame:31};
    try{
      h.selection.set([previous]);h.canvas.emit('pointerdown',{clientX:118.9,clientY:11});assert.deepEqual(h.selection.get(),[{target:transform,source_frame:30}]);h.canvas.emit('pointerup',{clientX:119.79,clientY:11});assert.deepEqual(h.selection.get(),[released]);assert.equal(h.commands.length,0);assert.equal(h.canvas.captures.size,0);
      h.selection.set([previous]);h.canvas.emit('pointerdown',{clientX:118.9,clientY:11,shiftKey:true});h.canvas.emit('pointerup',{clientX:119.79,clientY:11,shiftKey:true});assert.deepEqual(h.selection.get(),[previous,released]);assert.equal(h.commands.length,0);
      h.selection.set([previous]);h.canvas.emit('pointerdown',{clientX:110,clientY:11});h.canvas.emit('pointerup',{clientX:109,clientY:11});assert.deepEqual(h.selection.get(),[previous],'A release on the row label activates its row without replacing key selection');
    }finally{h.control.dispose();}
  }
});

test('lane click uses release modifiers while additive selection and selected-group drag retain every peer',async()=>{
  const a={target:transform,source_frame:30},b={target:text,source_frame:30},h=harness();try{
    for(const modifier of ['shiftKey','ctrlKey','metaKey']){h.selection.set([a,b]);h.canvas.emit('pointerdown',{clientX:199,clientY:11,[modifier]:true});h.canvas.emit('pointerup',{clientX:199,clientY:11,[modifier]:true});assert.deepEqual(h.selection.get(),[a,b]);}
    h.canvas.emit('pointerdown',{clientX:199,clientY:11,shiftKey:true});h.canvas.emit('pointerup',{clientX:199,clientY:11});assert.deepEqual(h.selection.get(),[a],'Native click modifiers are read on release');
    h.selection.set([a,b]);h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:199,clientY:11,shiftKey:true});assert.deepEqual(h.selection.get(),[a,b]);
    h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:217,clientY:11});await settle();assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit.picks,[a,b]);assert.equal(h.commands[0].edit.action.delta_source_frames,2);
  }finally{h.control.dispose();}
});

test('readonly lane clicks can isolate one pick but canceled or stale clicks never collapse the group',()=>{
  const a={target:transform,source_frame:30},b={target:text,source_frame:30},h=harness({editable:false});try{
    h.selection.set([a,b]);h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointermove',{clientX:217,clientY:11});h.canvas.emit('pointerup',{clientX:217,clientY:11});assert.deepEqual(h.selection.get(),[a,b]);assert.equal(h.commands.length,0);
    h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:199,clientY:11});assert.deepEqual(h.selection.get(),[a]);assert.equal(h.commands.length,0);
  }finally{h.control.dispose();}
  for(const cancel of [value=>value.canvas.emit('keydown',{key:'Escape'}),value=>value.canvas.emit('pointercancel'),value=>value.canvas.emit('lostpointercapture'),value=>value.window.emit('blur'),value=>value.setCurrent(false),value=>value.document.modal=true,value=>value.setEditable(false),value=>value.control.dispose()]){
    const active=harness();try{active.selection.set([a,b]);active.canvas.emit('pointerdown',{clientX:199,clientY:11});cancel(active);active.canvas.emit('pointerup',{clientX:199,clientY:11});assert.deepEqual(active.selection.get(),[a,b]);assert.equal(active.commands.length,0);assert.equal(active.canvas.captures.size,0);}finally{active.control.dispose();}
  }
});

test('additive lane marquee retains off-page mixed picks and moves them with the displayed group',async()=>{
  const selection=createKeyPickSelection();selection.set([{target:text,source_frame:25}]);const h=harness({selection});
  h.canvas.emit('pointerdown',{clientX:185,clientY:1,shiftKey:true});h.canvas.emit('pointerup',{clientX:205,clientY:21});
  assert.deepEqual(selection.get(),[{target:text,source_frame:25},{target:transform,source_frame:30}]);
  h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:181,clientY:11});await settle();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.picks.length,2);assert.equal(h.commands[0].edit.action.delta_source_frames,-2);h.control.dispose();
});

test('row activation and exact native key navigation work read-only without submitting edits',()=>{
  const h=harness({editable:false});h.canvas.emit('pointerdown',{clientX:30,clientY:55});assert.deepEqual(h.targets,[text]);
  h.canvas.emit('pointerdown',{clientX:199,clientY:33});h.canvas.emit('pointermove',{clientX:220,clientY:33});h.canvas.emit('pointerup',{clientX:220,clientY:33});
  assert.deepEqual(h.selection.get(),[{target:color,source_frame:30}]);
  h.canvas.emit('dblclick',{clientX:199,clientY:33});assert.deepEqual(h.seeks,[415]);h.canvas.emit('keydown',{key:'Delete'});
  assert.equal(h.commands.length,0);h.control.dispose();
});

test('lane drafts cancel on Escape, stale context, modal, hiding, scroll, changed selection and resize',()=>{
  for(const cancel of [h=>h.canvas.emit('keydown',{key:'Escape'}),h=>h.setCurrent(false),h=>h.document.modal=true,h=>h.document.hidden=true,h=>h.root.isConnected=false,h=>h.viewport.emit('scroll'),h=>h.selection.set([{target:text,source_frame:20}]),h=>h.canvas.rect.width=310]){
    const h=harness();h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointermove',{clientX:217,clientY:11});cancel(h);h.canvas.emit('pointerup',{clientX:217,clientY:11});
    assert.equal(h.commands.length,0);assert.equal(h.canvas.captures.size,0);h.control.dispose();
  }
});

test('visible time zoom does not become the source limit for retained off-screen keys or clip source zero',async()=>{
  const value=detail();value.curves.source_start=0;value.curves.source_end=99;
  const selection=createKeyPickSelection();selection.set([{target:text,source_frame:5},{target:transform,source_frame:30}]);const h=harness({value,selection});
  h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:115,clientY:11});await settle();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].edit.action.delta_source_frames,-5);assert.deepEqual(selection.get().map(pick=>pick.source_frame),[0,25]);h.control.dispose();
});

test('scoped Delete removes the complete mixed selection once and an empty lane selection does not own Delete',async()=>{
  const h=harness();assert.equal(h.canvas.emit('keydown',{key:'Delete'}).defaultPrevented,undefined);
  h.selection.set([{target:transform,source_frame:30},{target:text,source_frame:30}]);const event=h.canvas.emit('keydown',{key:'Delete'});await settle();
  assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit.action,{kind:'delete'});assert.equal(h.commands[0].edit.picks.length,2);assert.deepEqual(h.selection.get(),[]);h.control.dispose();
});

test('failed native collision restores the selection but does not replace a newer user selection',async()=>{
  for(const newer of [false,true]){
    let reject;const h=harness({commit:()=>new Promise((resolve,fail)=>reject=fail)});
    h.canvas.emit('pointerdown',{clientX:199,clientY:11});h.canvas.emit('pointerup',{clientX:217,clientY:11});
    if(newer)h.selection.set([{target:text,source_frame:39}]);reject(Error('KEYFRAME_COLLISION'));await settle();
    assert.deepEqual(h.selection.get(),newer?[{target:text,source_frame:39}]:[{target:transform,source_frame:30}]);assert.equal(h.commands.length,1);assert.equal(h.notices.length,1);h.control.dispose();
  }
});

test('virtualized lanes draw only visible rows and explicitly report incomplete native pages',()=>{
  const value=detail();value.curves.tracks=Array.from({length:200},(_,index)=>row(`Mask ${index}`,{kind:'mask',index,param:'CenterX'},[30]));value.event_keys=[];
  value.curves.tracks[199].key_count=257;value.curves.tracks[199].keys=[];value.key_page.total_pages=2;
  const h=harness({value});h.canvas.calls.length=0;h.viewport.scrollTop=190*KEYFRAME_ROW_HEIGHT;h.viewport.emit('scroll');
  const lastPaint=h.canvas.calls.map(call=>call[0]).lastIndexOf('fillRect');
  const labels=h.canvas.calls.slice(lastPaint).filter(call=>call[0]==='fillText').map(call=>call[1]);
  assert.deepEqual(labels,Array.from({length:10},(_,index)=>`Mask ${190+index}`));
  assert.match(h.status.textContent,/200 animated parameters/);assert.match(h.status.textContent,/199 of 456 keys shown, page 1\/2/);assert.equal(h.canvas.height,220);h.control.dispose();
});
