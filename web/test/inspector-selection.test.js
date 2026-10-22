import test from 'node:test';
import assert from 'node:assert/strict';
import {videoPropertySelection,audioPropertySelection,renderSelectedVideoProperties,renderSelectedAudioGain,renderSelectedVideoEffects,titleSelectionPatch,renderProperties} from '../js/inspector.js';

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
function harness(t,{video=true,effects=false,commit,editDetail=()=>{}}={}){
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
  const options={selection:getSelection(),getSelection,frame,getFrame:()=>frame,canInteract:()=>allowed,commit:operation=>{commands.push(operation);return commit?.(operation);},notice:message=>notices.push(message),primaryName:video?'First video':'First audio',visualState,timelineSize:[1920,1080],seek:frame=>seeks.push(frame)};
  const all=(node=root)=>[node,...node.children.flatMap(child=>typeof child==='object'?all(child):[])];
  const field=label=>all().find(node=>node['aria-label']===label);
  const render=()=>effects?renderSelectedVideoEffects(root,native,options):video?renderSelectedVideoProperties(root,native,options):renderSelectedAudioGain(root,native,options);
  const control=render();
  return {state,root,native,commands,notices,seeks,visualState,options,all,field,render,control,
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

test('compact numeric editing commits on completion, keeps typing local and shares the guarded Enter flight',async t=>{
  let finish;const h=harness(t,{commit:()=>new Promise(resolve=>{finish=resolve;})}),input=h.field('PositionX');
  input.value='12';input.dispatchEvent(new Event('input'));await settle();assert.deepEqual(h.commands,[]);
  input.dispatchEvent(new Event('change'));input.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
  assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit,{action:'transform',parameters:[{param:'PositionX',value:12}]});
  finish();await settle();h.setFrame(21);input.value='15';input.dispatchEvent(new Event('change'));await settle();assert.equal(h.commands.length,1);assert.match(h.notices.at(-1),/changed/);
});

test('native Inspector slider drafts cancel without a release replay and explicit later drags commit once',async t=>{
  const h=harness(t),slider=h.field('CropLeft slider'),number=h.field('CropLeft');
  slider.dispatchEvent(new Event('pointerdown'));slider.value=5;slider.dispatchEvent(new Event('input'));assert.equal(number.value,5);assert.deepEqual(h.commands,[]);
  const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});slider.dispatchEvent(escape);slider.dispatchEvent(new Event('change'));await settle();assert.equal(Number(number.value),0);assert.deepEqual(h.commands,[]);
  slider.dispatchEvent(new Event('pointerdown'));slider.value=8;slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'));slider.dispatchEvent(new Event('change'));await settle();assert.equal(h.commands.length,1);assert.deepEqual(h.commands[0].edit,{action:'transform',parameters:[{param:'CropLeft',value:8}]});
  slider.dispatchEvent(new Event('pointerdown'));slider.value=12;slider.dispatchEvent(new Event('input'));h.control.cancel();slider.dispatchEvent(new Event('change'));await settle();assert.equal(Number(number.value),8);assert.equal(h.commands.length,1);
});

test('compact Inspector preserves collapsed crop actions, accessible key navigation and native reset groups',async t=>{
  const h=harness(t),groups=h.all().filter(node=>node.className==='inspector-property-group');
  assert.equal(groups.find(node=>node.children[0].textContent==='Transform').open,true);assert.equal(groups.find(node=>node.children[0].textContent==='Crop').open,false);
  assert.equal(h.field('Toggle Position keyframes at playhead').textContent,'◆');assert.equal(h.field('Previous Position keyframe').textContent,'‹');assert.equal(h.field('Reset crop').textContent,'↺');
  assert.equal(h.field('Rotation').parent.textContent,'');assert.equal(h.field('Rotation')['aria-label'],'Rotation');
  h.click('Reset crop');await settle();assert.deepEqual(h.commands[0].edit,{action:'reset_transform',params:['CropLeft','CropTop','CropRight','CropBottom','CropSoftness'],reset_flip:false});
});

test('native key pager stays collapsed until requested and preserves page actions and navigation focus',async t=>{
  const h=harness(t),state=new Map(),pages=[],scope='epoch:timeline:9';h.native.key_page={index:0,total_pages:2,page_size:16};
  h.Element.prototype.focus=function(){this.focused=true;};
  const render=()=>{const root=new h.Element('div');renderProperties(root,h.native,{writable:true,getFrame:()=>20,commit:async()=>{},reload(){},notice(){},visualState:state,scope,setKeyPage:page=>pages.push(page),transformControls:false,gainControls:false,compositing:false});return root;};
  const root=render(),pager=root.children[0];assert.equal(pager.dataset.visualPath,'key-page-controls');assert.equal(pager.open,false);
  h.all(pager).find(node=>node.textContent==='Next key page').dispatchEvent(new Event('click'));assert.deepEqual(pages,[1]);
  state.set('key-page-focus',scope);const requested=render(),input=h.all(requested.children[0]).find(node=>node.tagName==='input');await settle();
  assert.equal(requested.children[0].open,true);assert.equal(input.focused,true);assert.equal(state.has('key-page-focus'),false);
});

test('linked Zoom edit sends only changed axes, while native row diamond always includes both axes',async t=>{
  const h=harness(t);const link=h.field('Link selected Zoom X/Y');link.checked=true;link.dispatchEvent(new Event('change'));await settle();assert.deepEqual(h.commands,[]);
  h.apply('ZoomY','1.5');await settle();
  assert.deepEqual(h.commands[0].edit,{action:'transform',parameters:[{param:'ZoomY',value:1.5},{param:'ZoomX',value:1.5}]});
  h.click('Toggle Zoom keyframes at playhead');await settle();assert.deepEqual(h.commands[1].edit,{action:'toggle_transform_keys',params:['ZoomX','ZoomY']});
});

test('dedicated key editor root owns the pager and closed windows suppress key UI without losing Inspector controls',t=>{
  const h=harness(t),outlet=new h.Element('div');h.native.key_page={index:0,total_pages:3,page_size:16};
  const options={writable:true,getFrame:()=>20,commit:async()=>{},reload(){},notice(){},visualState:new Map(),setKeyPage(){},transformControls:false,gainControls:false,compositing:false};
  const inspector=new h.Element('div');renderProperties(inspector,h.native,{...options,keyEditorRoot:outlet});
  assert.equal(h.all(outlet).filter(node=>node.dataset.visualPath==='key-page-controls').length,1);
  assert.equal(h.all(inspector).some(node=>node.dataset.visualPath==='key-page-controls'),false);
  assert.ok(h.all(inspector).some(node=>node.textContent==='Fade in frames'));
  const closed=new h.Element('div');renderProperties(closed,h.native,{...options,keyEditorRoot:null});
  assert.equal(h.all(closed).some(node=>node.dataset.visualPath==='key-page-controls'),false);
  assert.ok(h.all(closed).some(node=>node.textContent==='Fade out frames'));
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

const keyInfo=(on=false,previous=12,next=31)=>({on_keyframe:on,previous_frame:previous,next_frame:next});
function titleDetail(native){
  native.title={content:{default:'Default text',value:'Current animated text',keyframes:[[0,'First','Hold']],key_count:100,keyframe_info:keyInfo(true)},font_family:'Server font',font_weight:400,italic:false,underline:false,strikethrough:false,size:96,tracking:0,line_spacing:0,case:'Mixed',align:'Center',anchor:['Center','Middle'],position:[10,-20],color:{r:1,g:1,b:1,a:1},background:{enabled:true,color:{r:0,g:0,b:0,a:1},outline_color:{r:1,g:1,b:1,a:1},outline_width:2,width:0.2,height:0.3,corner_radius:0.1,center:[5,8],opacity:80}};
}
function filterDetail(native){
  const value=(number,on=false)=>({value:number,keyframes:[],key_count:100,keyframe_info:keyInfo(on)});
  native.filters={kinds:['GaussianBlur','Exposure','DropShadow','ColorCorrection'],blur_radius_max:512,shadow_grow_max:1024,blur_directions:['Both','Horizontal','Vertical'],grade_presets:['Neutral','BlackAndWhite'],wheels:[],stack:[
    {kind:'GaussianBlur',enabled:true,radius:value(2,true),direction:'Both',direction_info:{value:'Both',keyframe_info:keyInfo(false,10,40)}},
    {kind:'DropShadow',enabled:true,radius:value(4),grow:value(2),amount:value(80),amount_range:[0,100],offset:[{...value(3),keyframe_info:keyInfo(true,11,40)},{...value(5),keyframe_info:keyInfo(false,15,35)}],color:{r:0,g:0,b:0,a:1}},
    {kind:'Exposure',enabled:false,amount:value(1),amount_range:[-10,10]},
  ]};
}

test('title patches contain only changed fields and never copy unrelated text or peer metadata',()=>{
  const before={text:'One title',size:96,background:{enabled:true,width:0.2,color:{r:0,g:0,b:0,a:1}}},after={size:96,background:{...before.background,width:0.5}};
  assert.deepEqual(titleSelectionPatch(before,after),{background:after.background});assert.deepEqual(before.text,'One title');assert.deepEqual(titleSelectionPatch(before,{size:96}),{});
});

test('selected Title includes native missing placement/case/background controls and emits changed fields only',async t=>{
  const h=harness(t,{effects:true,editDetail:titleDetail});
  assert.equal(h.field('Title text').value,'Current animated text');assert.equal(h.field('Title position X (from bottom-left)').value,970);assert.equal(h.field('Title position Y (from bottom-left)').value,520);
  for(const label of ['Title case','Title horizontal anchor','Title vertical anchor','Background color R','Background outline color A','Background outline width','Background width','Background height','Background corner radius','Background center X','Background center Y','Background opacity'])assert.ok(h.field(label),label);
  h.apply('Font size',120);await settle();h.field('Title case').value='Upper';h.field('Title case').dispatchEvent(new Event('change'));await settle();h.apply('Title position X (from bottom-left)',1000);await settle();h.apply('Background width',0.5);await settle();
  assert.deepEqual(h.commands.slice(0,3).map(command=>command.edit),[{action:'title',patch:{size:120}},{action:'title',patch:{case:'Upper'}},{action:'title',patch:{position:[40,-20]}}]);
  assert.deepEqual(h.commands[3].edit,{action:'title',patch:{background:{...h.native.title.background,width:0.5}}});assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='9,2' && command.timeline_frame===20 && !Object.hasOwn(command,'source_frame')));
});

test('title text keys and row/background resets use native own-clock actions and complete metadata',async t=>{
  const h=harness(t,{effects:true,editDetail:titleDetail});h.click('Toggle title text keyframes at playhead');await settle();h.click('Previous title text keyframe');h.click('Next title text keyframe');
  for(const label of ['Reset title style','Reset title anchor','Reset title background','Reset background corner radius']){h.click(label);await settle();}
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'toggle_text_key'},{action:'reset_title',fields:['font_weight','italic']},{action:'reset_title',fields:['anchor']},{action:'reset_title',fields:['background']},{action:'reset_title',fields:['background_corner_radius']}]);assert.deepEqual(h.seeks,[12,31]);
  assert.equal(h.field('Toggle title text keyframes at playhead')['aria-pressed'],'true');h.apply('Title text','€'.repeat(1400));await settle();assert.equal(h.commands.length,5);assert.match(h.notices.at(-1),/UTF-8/);
  h.field('Title drop shadow').checked=true;h.field('Title drop shadow').dispatchEvent(new Event('change'));await settle();assert.deepEqual(h.commands.at(-1).edit,{action:'title_shadow',enabled:true});
});

test('Solid color uses native evaluated color and a selected diamond without inventing a reset control',async t=>{
  const h=harness(t,{effects:true,editDetail:native=>{native.color={r:0,g:0,b:0,a:1};native.color_info={value:{r:0.2,g:0.3,b:0.4,a:1},keyframe_info:keyInfo(true,4,33)};}});
  assert.equal(h.field('Solid color R').value,0.2);h.apply('Solid color R',0.5);await settle();h.click('Toggle solid color keyframes at playhead');await settle();h.click('Next solid color keyframe');
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'solid_color',value:{r:0.5,g:0.3,b:0.4,a:1}},{action:'toggle_color_key'}]);assert.deepEqual(h.seeks,[33]);assert.equal(h.all().some(node=>node.textContent==='Reset solid color'),false);assert.equal(h.field('Title text'),undefined);
});

test('type-specific Title/Solid controls follow the authoritative primary rather than searching other selected types',t=>{
  const h=harness(t,{effects:true});assert.equal(h.field('Title text'),undefined);assert.equal(h.field('Solid color R'),undefined);
  const root=new h.Element('div');renderSelectedVideoEffects(root,{...h.native,clip_id:'2',title:{}},h.options);assert.deepEqual(root.children,[]);
  renderSelectedVideoEffects(root,{...h.native,color_info:null,color:{r:1,g:0,b:0,a:1}},h.options);assert.equal(h.all(root).some(node=>node['aria-label']==='Solid color R'),false);
});

test('selected filter Apply, direction, enabled and stack operations each send one native selected edit',async t=>{
  const h=harness(t,{effects:true,editDetail:filterDetail});h.apply('GaussianBlur radius',8);await settle();h.field('GaussianBlur direction').value='Horizontal';h.field('GaussianBlur direction').dispatchEvent(new Event('change'));await settle();h.click('Exposure enabled');await settle();
  h.click('Move up DropShadow');await settle();h.click('Remove Exposure from selection');await settle();h.field('Visual filter type').value='Exposure';h.click('Add visual filter to selection');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'filter',filter:'GaussianBlur',patch:{radius:8}},{action:'filter',filter:'GaussianBlur',patch:{direction:'Horizontal'}},{action:'filter',filter:'Exposure',patch:{enabled:true}},{action:'filter_move',filter:'DropShadow',to_index:0},{action:'filter_presence',filter:'Exposure',enabled:false},{action:'filter_presence',filter:'Exposure',enabled:true}]);assert.ok(h.commands.every(command=>command.clip_ids.join(',')==='9,2'));
  h.apply('GaussianBlur radius','');h.apply('GaussianBlur radius',Infinity);h.click('Move up GaussianBlur');await settle();assert.equal(h.commands.length,6);
});

test('filter row diamonds/navigation/reset use native full-track metadata and grouped offset parameters',async t=>{
  const h=harness(t,{effects:true,editDetail:filterDetail});h.click('Toggle DropShadow offset keyframes at playhead');await settle();h.click('Previous DropShadow offset keyframe');h.click('Next DropShadow offset keyframe');h.click('Reset DropShadow offset');await settle();h.click('Reset GaussianBlur filter');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'toggle_filter_keys',filter:'DropShadow',params:[{kind:'offset',axis:0},{kind:'offset',axis:1}]},{action:'reset_filter',filter:'DropShadow',params:[{kind:'offset',axis:0},{kind:'offset',axis:1}],reset_enabled:false,reset_color:false,reset_grade:false},{action:'reset_filter',filter:'GaussianBlur',params:[{kind:'radius'},{kind:'direction'}],reset_enabled:true,reset_color:false,reset_grade:false}]);assert.deepEqual(h.seeks,[15,35]);assert.equal(h.field('Toggle DropShadow offset keyframes at playhead')['aria-pressed'],'true');
});

test('ColorCorrection numeric values, presets and resets also use selected native operations',async t=>{
  const h=harness(t,{effects:true,editDetail:native=>{filterDetail(native);native.filters.stack=[{kind:'ColorCorrection',enabled:true,grade:[{param:'Saturation',value:1,range:[0,2],keyframe_info:keyInfo()}]}];}});
  assert.equal(h.field('Apply native color preset').disabled,true);h.apply('Saturation',0.5);await settle();h.field('Native color preset').value='BlackAndWhite';h.field('Native color preset').dispatchEvent(new Event('change'));assert.equal(h.field('Apply native color preset').disabled,false);h.click('Apply native color preset');await settle();h.click('Reset ColorCorrection grade');await settle();
  assert.deepEqual(h.commands.map(command=>command.edit),[{action:'filter',filter:'ColorCorrection',patch:{grade:[{param:'Saturation',value:0.5}]}},{action:'grade_preset',preset:'BlackAndWhite'},{action:'reset_filter',filter:'ColorCorrection',params:[],reset_enabled:false,reset_color:false,reset_grade:true}]);
});

test('selected effects reject stale context, changed playhead, detached roots and modal/playback guards',async t=>{
  const h=harness(t,{effects:true,editDetail:native=>{titleDetail(native);filterDetail(native);}}),before=structuredClone(h.state);
  for(const change of [state=>{state.project_epoch='new';},state=>{state.generation='8';},state=>{state.timeline.id='other';},state=>{state.timeline.revision='other';},state=>{state.selection=['9'];},state=>{state.timeline.tracks[1].locked=true;}]){Object.assign(h.state,structuredClone(before));change(h.state);h.apply('Font size',120);h.apply('GaussianBlur radius',8);h.click('Toggle title text keyframes at playhead');await settle();}
  Object.assign(h.state,before);h.setFrame(21);h.click('Reset title background');h.setFrame(20);h.allow(false);h.click('Remove Exposure from selection');h.allow(true);h.root.isConnected=false;h.apply('Font size',130);await settle();assert.deepEqual(h.commands,[]);
  h.root.isConnected=true;h.apply('Font size',130);h.state.generation='new';await settle();assert.deepEqual(h.commands,[]);assert.match(h.notices.at(-1),/changed/);
});

test('one selected-effects owner blocks duplicate actions and preserves an unknown outcome without replay',async t=>{
  let reject;const h=harness(t,{effects:true,editDetail:native=>{titleDetail(native);filterDetail(native);},commit:()=>new Promise((resolve,fail)=>{reject=fail;})});
  h.apply('Font size',120);h.apply('GaussianBlur radius',9);h.click('Toggle title text keyframes at playhead');await settle();assert.equal(h.commands.length,1);h.allow(false);reject(Object.assign(Error('Command outcome unknown'),{code:'OUTCOME_UNKNOWN'}));await settle();
  const notices=[...h.notices];assert.match(notices.at(-1),/unknown/);assert.ok(h.all().filter(node=>['input','textarea','button','select'].includes(node.tagName)).every(node=>node.disabled));
  h.click('Reset GaussianBlur filter');h.allow(true);h.click('Toggle title text keyframes at playhead');h.click('Next title text keyframe');await settle();assert.equal(h.commands.length,1);assert.deepEqual(h.seeks,[]);assert.deepEqual(h.notices,notices);
});

test('selected-effects mode removes duplicate legacy Title/Solid/Filters while preserving primary Fade',async t=>{
  const h=harness(t,{effects:true,editDetail:native=>{titleDetail(native);filterDetail(native);}}),root=new h.Element('div');
  renderProperties(root,h.native,{writable:true,getFrame:()=>20,commit:operation=>{h.commands.push(operation);return Promise.resolve();},reload:()=>{},notice:()=>{},visualState:new Map(),canInteract:()=>true,transformControls:false,gainControls:false,compositing:false,titleControls:false,colorControls:false,filterControls:false});
  assert.equal(h.all(root).some(node=>node.textContent==='Title typography' || node.textContent==='Filters and color'),false);const fade=h.all(root).find(node=>node.tagName==='label' && node.textContent==='Fade out frames').children[0];fade.value=7;fade.parent.parent.dispatchEvent(new Event('submit',{cancelable:true}));await settle();assert.deepEqual(h.commands,[{kind:'set_properties',clip_id:'9',patch:{fade_out:7}}]);
});
