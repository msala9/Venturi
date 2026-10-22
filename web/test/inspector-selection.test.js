import test from 'node:test';
import assert from 'node:assert/strict';
import {videoPropertySelection,audioPropertySelection,renderSelectedVideoProperties,renderSelectedAudioGain,renderProperties} from '../js/inspector.js';

const axes=['ZoomX','ZoomY','PositionX','PositionY','Rotation','AnchorX','AnchorY','CropLeft','CropTop','CropRight','CropBottom','CropSoftness','Opacity'];
const snapshot=()=>({project_epoch:'epoch',generation:'7',timeline:{id:'timeline',revision:'revision',tracks:[
  {id:'audio',kind:'audio',locked:false,clips:[{id:'a-later',start_frame:40,linked_group:'linked'},{id:'a-primary',start_frame:4}]},
  {id:'video',kind:'video',locked:false,clips:[{id:'2',start_frame:48,kind:'solid',linked_group:'linked'},{id:'9',start_frame:0,kind:'text'},{id:'unselected',start_frame:90,linked_group:'linked'}]},
  {id:'locked',kind:'video',locked:true,clips:[{id:'locked',start_frame:0,linked_group:'linked'}]},
]},selection:['a-later','2','locked','a-primary','9']});
function detail(video=true){
  return {clip_id:video?'9':'a-primary',video,locked:false,timeline_frame:20,source_frame:133,
    transform:axes.map(param=>({param,value:param==='Opacity'?75:param.startsWith('Zoom')?1:0,default:0,min:param==='Opacity'?0:-8192,max:param==='Opacity'?100:8192,keyframes:[],key_count:0,keyframe_info:{on_keyframe:false,previous_frame:null,next_frame:null}})),
    flip:[false,true],gain:{value:-3,keyframes:[],key_count:0,keyframe_info:{on_keyframe:false,previous_frame:10,next_frame:30}},fade_in:2,fade_out:3,length_frames:60,
    display_colors:[],filters:{kinds:[],stack:[]},masks:{items:[]},curves:{tracks:[]},transitions:{in:null,out:null,cut_max_frames:null},
  };
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness(t,{video=true,commit,editDetail=()=>{}}={}){
  const priorDocument=globalThis.document,priorOption=globalThis.Option;
  class Element extends EventTarget{
    constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.style={};this.disabled=false;this.isConnected=true;this.value='';}
    append(...children){for(const child of children){this.children.push(child);if(typeof child==='object')child.parent=this;}}
    setAttribute(name,value){this[name]=String(value);}
    get options(){return this.children;}
    reportValidity(){return true;}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Option=class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}};
  t.after(()=>{globalThis.document=priorDocument;globalThis.Option=priorOption;});
  const state=snapshot(),root=new Element('div'),native=detail(video),commands=[],notices=[],seeks=[],visualState=new Map();editDetail(native);
  let allowed=true,frame=20;
  const getSelection=()=>video?videoPropertySelection(state):audioPropertySelection(state);
  const options={selection:getSelection(),getSelection,frame,getFrame:()=>frame,canInteract:()=>allowed,commit:operation=>{commands.push(operation);return commit?.(operation);},notice:message=>notices.push(message),primaryName:video?'First video':'First audio',visualState,seek:frame=>seeks.push(frame)};
  const all=(node=root)=>[node,...node.children.flatMap(child=>typeof child==='object'?all(child):[])];
  const field=label=>all().find(node=>node['aria-label']===label);
  const render=()=>video?renderSelectedVideoProperties(root,native,options):renderSelectedAudioGain(root,native,options);
  render();
  return {state,root,native,commands,notices,seeks,visualState,options,all,field,render,
    click:label=>{assert.ok(field(label),label);field(label).dispatchEvent(new Event('click'));},
    apply(label,value){const input=field(label);assert.ok(input,label);input.value=value;input.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));},
    allow:value=>{allowed=value;},setFrame:value=>{frame=value;},Element};
}

test('video and audio primary targets use native lane/start ordering without linked expansion',()=>{
  const state=snapshot(),before=structuredClone(state);
  assert.deepEqual(videoPropertySelection(state).clip_ids,['9','2']);
  assert.deepEqual(audioPropertySelection(state).clip_ids,['a-primary','a-later']);
  assert.deepEqual(state,before);
  state.selection=['2','locked'];assert.equal(audioPropertySelection(state),null);
  state.selection=['a-later','missing'];assert.equal(audioPropertySelection(state),null);
});

test('all thirteen video axes appear once and Apply forwards selected native targets, raw playhead and values only',async t=>{
  const h=harness(t);
  for(const param of axes)assert.equal(h.all().filter(node=>node['aria-label']===param).length,1);
  h.apply('PositionX','12.5');await settle();
  assert.deepEqual(h.commands,[{kind:'edit_inspector_selection',clip_ids:['9','2'],timeline_frame:20,edit:{action:'transform',parameters:[{param:'PositionX',value:12.5}]}}]);
  assert.equal(h.native.transform.find(parameter=>parameter.param==='PositionX').value,0);
  assert.ok(h.all().some(node=>node.textContent?.includes('constant default or writes a native key')));
});

test('empty, nonfinite and unchanged numeric Apply never substitutes zero or sends a command',async t=>{
  const h=harness(t);for(const value of ['', '  ', 'bad', 'Infinity','0'])h.apply('PositionX',value);await settle();assert.deepEqual(h.commands,[]);
});

test('linked Zoom edit sends only changed axes, while native row diamond always includes both axes',async t=>{
  const h=harness(t);const link=h.field('Link selected Zoom X/Y');link.checked=true;link.dispatchEvent(new Event('change'));await settle();assert.deepEqual(h.commands,[]);
  h.apply('ZoomY','1.5');await settle();
  assert.deepEqual(h.commands[0].edit,{action:'transform',parameters:[{param:'ZoomY',value:1.5},{param:'ZoomX',value:1.5}]});
  h.click('Toggle Zoom keyframes at playhead');await settle();assert.deepEqual(h.commands[1].edit,{action:'toggle_transform_keys',params:['ZoomX','ZoomY']});
});

test('enabling Zoom link applies only the differing Y axis and persists the shared preference',async t=>{
  const h=harness(t,{editDetail:detail=>{detail.transform.find(parameter=>parameter.param==='ZoomY').value=2;}});
  const link=h.field('Link selected Zoom X/Y');link.checked=true;link.dispatchEvent(new Event('change'));await settle();
  assert.deepEqual(h.commands[0].edit,{action:'transform',parameters:[{param:'ZoomY',value:1}]});assert.equal(h.visualState.get('zoom-link'),true);
});

test('row diamonds use complete native metadata and forward no primary typed value or source frame',async t=>{
  const h=harness(t,{editDetail:detail=>{
    const x=detail.transform.find(parameter=>parameter.param==='PositionX'),y=detail.transform.find(parameter=>parameter.param==='PositionY');
    x.keyframes=Array.from({length:16},(_,index)=>[index,0,'Linear']);x.key_count=100;
    x.keyframe_info={on_keyframe:true,previous_frame:8,next_frame:35};y.keyframe_info={on_keyframe:false,previous_frame:12,next_frame:31};
  }});
  assert.equal(h.field('Toggle Position keyframes at playhead')['aria-pressed'],'true');
  h.field('PositionX').value=999;h.click('Toggle Position keyframes at playhead');await settle();
  assert.deepEqual(h.commands[0].edit,{action:'toggle_transform_keys',params:['PositionX','PositionY']});
  h.click('Previous Position keyframe');h.click('Next Position keyframe');assert.deepEqual(h.seeks,[12,31]);assert.equal(h.commands.length,1);
});

test('old detail without full-track key metadata disables navigation instead of using truncated summaries',t=>{
  const h=harness(t,{editDetail:detail=>{for(const parameter of detail.transform){delete parameter.keyframe_info;parameter.keyframes=[[3,1,'Linear']];}}});
  assert.equal(h.field('Toggle Zoom keyframes at playhead')['aria-pressed'],undefined);
  assert.equal(h.field('Previous Zoom keyframe').disabled,true);assert.equal(h.field('Next Zoom keyframe').disabled,true);
  h.click('Previous Zoom keyframe');assert.deepEqual(h.seeks,[]);
});

test('native Transform, Crop, row, Flip and compositing resets remain distinct single operations',async t=>{
  const h=harness(t);
  for(const label of ['Reset transform','Reset crop','Reset anchor row','Reset flip','Reset opacity row','Reset compositing']){h.click(label);await settle();}
  assert.deepEqual(h.commands.map(command=>command.edit),[
    {action:'reset_transform',params:['ZoomX','ZoomY','PositionX','PositionY','Rotation','AnchorX','AnchorY'],reset_flip:true},
    {action:'reset_transform',params:['CropLeft','CropTop','CropRight','CropBottom','CropSoftness'],reset_flip:false},
    {action:'reset_transform',params:['AnchorX','AnchorY'],reset_flip:false},
    {action:'reset_transform',params:[],reset_flip:true},
    {action:'reset_transform',params:['Opacity'],reset_flip:false},
    {action:'reset_compositing'},
  ]);
  assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='9,2'));
});

test('Flip sends only the chosen axis and primary enabled state, never a copied two-axis array',async t=>{
  const h=harness(t);h.click('Flip horizontal');await settle();h.click('Flip vertical');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'flip',axis:0,enabled:true},{action:'flip',axis:1,enabled:false}]);assert.deepEqual(h.native.flip,[false,true]);
});

test('selected audio gain edits all selected unlocked audio targets with native Apply, diamond and reset',async t=>{
  const h=harness(t,{video:false});h.apply('Selected gain dB','-6');await settle();h.click('Toggle gain keyframes at playhead');await settle();h.click('Reset gain');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'gain',value:-6},{action:'toggle_gain_key'},{action:'reset_gain'}]);
  assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='a-primary,a-later' && command.timeline_frame===20));
  h.click('Next gain keyframe');assert.deepEqual(h.seeks,[30]);assert.equal(h.all().some(node=>node['aria-label']==='PositionX'),false);
});

test('wrong-primary, locked and mismatched-role details cannot render editable selected controls',t=>{
  const h=harness(t),root=new h.Element('div');
  for(const detail of [{...h.native,clip_id:'2'},{...h.native,locked:true},{...h.native,video:false}])renderSelectedVideoProperties(root,detail,h.options);
  renderSelectedAudioGain(root,{...h.native,gain:{value:0}},h.options);assert.deepEqual(root.children,[]);
});

test('a late native detail cannot publish selected controls after selection/context or playhead changes',t=>{
  const h=harness(t),root=new h.Element('div');h.state.generation='8';
  renderSelectedVideoProperties(root,h.native,h.options);assert.deepEqual(root.children,[]);
  h.state.generation='7';h.setFrame(21);renderSelectedVideoProperties(root,h.native,h.options);assert.deepEqual(root.children,[]);
});

test('every selected-target action refuses changed project, generation, timeline, revision, selection and locks',async t=>{
  const h=harness(t),before=structuredClone(h.state);
  const changes=[state=>{state.project_epoch='other';},state=>{state.generation='8';},state=>{state.timeline.id='other';},state=>{state.timeline.revision='other';},state=>{state.selection=state.selection.filter(id=>id!=='a-later');},state=>{state.timeline.tracks[1].locked=true;}];
  for(const change of changes){Object.assign(h.state,structuredClone(before));change(h.state);h.click('Reset transform');h.apply('Opacity','50');h.click('Toggle Zoom keyframes at playhead');h.click('Flip horizontal');h.click('Next Zoom keyframe');await settle();}
  assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
});

test('playhead, detached card and read-only/modal/playback guards prevent selected writes and key navigation',async t=>{
  const h=harness(t,{video:false});
  h.setFrame(21);h.click('Reset gain');h.setFrame(20);h.allow(false);h.apply('Selected gain dB',-6);h.click('Toggle gain keyframes at playhead');h.click('Next gain keyframe');
  h.allow(true);h.root.isConnected=false;h.click('Reset gain');await settle();assert.deepEqual(h.commands,[]);assert.deepEqual(h.seeks,[]);
});

test('a changed context between dispatch and commit microtask cancels without applying to the new selection',async t=>{
  const h=harness(t);h.click('Reset transform');h.state.selection=['9'];await settle();assert.deepEqual(h.commands,[]);assert.match(h.notices[0],/changed/);
});

test('all selected handlers share one pending request and remain disabled after unknown outcome',async t=>{
  let finish,h;h=harness(t,{commit:()=>new Promise((resolve,reject)=>{finish=reject;})});
  h.apply('PositionX',5);h.click('Reset transform');h.click('Toggle Zoom keyframes at playhead');h.click('Flip horizontal');await settle();
  assert.equal(h.commands.length,1);assert.ok(h.all().filter(node=>['input','button'].includes(node.tagName)).every(node=>node.disabled));
  h.allow(false);finish(Error('Command outcome unknown; reconnect'));await settle();h.click('Reset crop');await settle();
  assert.equal(h.commands.length,1);assert.match(h.notices[0],/unknown/);
});

test('known native failure is surfaced once and requires a new explicit action, with no automatic replay',async t=>{
  let attempts=0;const h=harness(t,{commit:()=>++attempts===1?Promise.reject(Error('Native crop refused')):Promise.resolve()});
  h.apply('CropLeft',10);await settle();assert.equal(h.commands.length,1);assert.match(h.notices[0],/crop refused/);
  h.click('Reset crop');await settle();assert.equal(h.commands.length,2);
});

test('selected-target mode removes duplicate legacy Transform/Flip/Gain while Fade remains one primary clip',async t=>{
  const h=harness(t),root=new h.Element('div');
  renderProperties(root,h.native,{writable:true,getFrame:()=>20,commit:operation=>{h.commands.push(operation);return Promise.resolve();},reload:()=>{},notice:()=>{},visualState:new Map(),canInteract:()=>true,transformControls:false,gainControls:false,compositing:false});
  const all=h.all(root.children[0]);assert.equal(all.filter(node=>node.tagName==='input' && node.type==='number').length,2);
  assert.equal(all.some(node=>node.textContent==='Flip horizontal'),false);assert.equal(all.some(node=>node.textContent==='Link Zoom X/Y'),false);
  const fade=all.find(node=>node.tagName==='label' && node.textContent==='Fade in frames').children[0];fade.value=7;fade.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(h.commands,[{kind:'set_properties',clip_id:'9',patch:{fade_in:7}}]);
});
