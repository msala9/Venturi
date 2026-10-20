import test from "node:test";
import assert from "node:assert/strict";
import {comparisonTime,createReview,knownTakeMetadata,reviewIdentity} from "../js/review.js";

test("review replacement identity ignores transport time but binds the selected native document and clip",()=>{
  const context={query:{project_epoch:"epoch",if_generation:"2",timeline_id:"1",revision:"rev",frame:12,width:640},clip:{id:"9007199254740993"}};
  assert.equal(reviewIdentity(context),reviewIdentity({...context,query:{...context.query,frame:100}}));
  for(const key of ["project_epoch","if_generation","timeline_id","revision"])assert.notEqual(reviewIdentity(context),reviewIdentity({...context,query:{...context.query,[key]:"changed"}}));
  assert.notEqual(reviewIdentity(context),reviewIdentity({...context,clip:{id:"different"}}));assert.equal(reviewIdentity(null),null);
});
test("comparison uses equal elapsed seconds and holds a shorter take without changing playback speed",()=>{
  assert.equal(comparisonTime(1.25,3),1.25);assert.equal(comparisonTime(4,3),2.999);assert.equal(comparisonTime(-1,3),0);
  for(const duration of [NaN,Infinity,0,-1])assert.equal(comparisonTime(1,duration),null);assert.equal(comparisonTime(NaN,3),null);
});
test("review displays generation metadata only when supplied and preserves the exact seed string",()=>{
  assert.equal(knownTakeMetadata({name:"take.mp4"}),"Generation metadata not supplied");assert.equal(knownTakeMetadata({shared_origin:{item:{model:"",prompt:null,seed:null}}}),"Generation metadata not supplied");
  assert.equal(knownTakeMetadata({shared_origin:{item:{model:"known model",prompt:"<script>quoted source text</script>",seed:"18446744073709551615"}}}),"Model: known model\nSeed: 18446744073709551615\nPrompt: <script>quoted source text</script>");
});

class Control extends EventTarget {
  constructor(value=""){super();this.value=value;this.disabled=false;this.children=[];this.textContent="";this.checked=true;this.paused=true;}
  replaceChildren(...children){this.children=children;}
  append(child){this.children.push(child);}
  click(){if(!this.disabled)this.dispatchEvent(new Event("click"));}
  pause(){this.paused=true;}
  async play(){this.paused=false;this.dispatchEvent(new Event("play"));}
}
function harness(api){
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};globalThis.document={createElement:()=>new Control()};
  const selectors=["form","[data-review-status]","[data-review-apply]","[data-review-plan]","[data-review-changes]","[data-review-refresh]","[data-review-close]","[data-review-play]","[data-review-swap]",'[name="sync"]','[name="listen"]',"[data-review-target]"];
  const nodes=Object.fromEntries(selectors.map(selector=>[selector,new Control()])),root=new Control(),panes=[];root.querySelector=selector=>nodes[selector];root.showModal=()=>{root.open=true;};root.close=()=>{root.open=false;};
  for(const name of ["A","B"]){const parts=Object.fromEntries(["select","video","img","output","button","pre"].map(selector=>[selector,new Control()])),pane={querySelector:selector=>parts[selector]};nodes[`[data-review-pane="${name}"]`]=pane;panes.push(parts);}
  nodes.form.elements=Object.fromEntries(Object.entries({source_in:"0",duration:"preserve",links:"replace_linked",attributes:"preserve"}).map(([name,value])=>[name,new Control(value)]));nodes.form.reportValidity=()=>true;
  nodes['[name="listen"]'].value="A";
  const context={query:{project_epoch:"epoch",if_generation:"2",timeline_id:"1",revision:"rev",frame:12,width:640},clip:{id:"1",media_id:"2",name:"old.mp4",start_frame:12,length_frames:72},document:{media:[{id:"2",name:"old.mp4"},{id:"3",name:"new.mp4"}]}},commits=[],loaded=[];let writable=true;
  const review=createReview({root,getContext:()=>context,canCommit:()=>writable,commit:async operation=>{commits.push(operation);context.query.if_generation="3";review.invalidate();},notice(){},api:(path,body)=>path.startsWith("/review?")?Promise.resolve({items:[],shots:{},project_epoch:"epoch",generation:"2"}):api(path,body),sourceFactory:({onReady,cancel})=>({reset(){},async open(item){loaded.push(item.id);cancel.disabled=true;onReady();}})});
  return{review,root,nodes,panes,context,commits,loaded,button:name=>nodes[`[data-review-${name}]`],setWritable:value=>{writable=value;},submit:()=>nodes.form.dispatchEvent(new Event("submit",{cancelable:true}))};
}
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}
const planned={source_version:"verified-file",removed_crossings:0,changes:[{track:"0",clip_id:"1",start_frame:12,previous_length:72,length:60,source_in:0,source_out:75}]};

test("changing a take discards a late native plan and cannot enable an obsolete confirmation",async()=>{
  let resolvePlan;const h=harness(()=>new Promise(resolve=>{resolvePlan=resolve;}));await h.review.open();assert.deepEqual(h.loaded,["2","3"]);assert.equal(h.button("apply").disabled,true);h.submit();await settle();
  h.panes[1].select.value="2";h.panes[1].select.dispatchEvent(new Event("change"));resolvePlan(planned);await settle();assert.equal(h.button("apply").disabled,true);assert.equal(h.nodes["[data-review-changes]"].children.length,0);h.button("apply").click();await settle();assert.equal(h.commits.length,0);
});
test("a short-take refusal needs explicit policy and confirmation; native refresh during commit remains safe",async()=>{
  const calls=[];const h=harness(async(path,body)=>{calls.push({path,body});if(body.replacement.duration==="preserve")throw Error("The take is too short");return planned;});await h.review.open();h.submit();await settle();assert.match(h.nodes["[data-review-status]"].textContent,/too short/);assert.equal(h.button("apply").disabled,true);assert.equal(h.commits.length,0);
  h.nodes.form.elements.duration.value="shorten";h.nodes.form.dispatchEvent(new Event("change"));h.submit();await settle();assert.equal(h.button("apply").disabled,false);assert.equal(h.nodes["[data-review-changes]"].children.length,1);h.button("apply").click();await settle();assert.equal(h.root.open,false);assert.deepEqual(h.commits,[{kind:"replace_take",replacement:{clip_id:"1",media_id:"3",source_in:0,duration:"shorten",links:"replace_linked",attributes:"preserve",source_version:"verified-file"}}]);assert.equal(calls.length,2);
});
test("stale native documents and read-only ownership cannot confirm a replacement",async()=>{
  const h=harness(async()=>planned);await h.review.open();h.submit();await settle();h.context.query.revision="changed";h.review.invalidate();assert.equal(h.button("apply").disabled,true);h.button("apply").click();await settle();assert.equal(h.commits.length,0);
  await h.review.open();h.setWritable(false);h.submit();await settle();assert.equal(h.button("apply").disabled,true);assert.equal(h.commits.length,0);
});

test("native animation-key merging is visible before confirmation",async()=>{
  const h=harness(async()=>({...planned,merged_keys:2}));await h.review.open();h.submit();await settle();assert.equal(h.commits.length,0);assert.match(h.nodes["[data-review-changes]"].children[1].textContent,/2 animation key.*will merge/);assert.equal(h.button("apply").disabled,false);
});

test("native video mute controls keep the A/B audition choice exclusive",async()=>{
  const h=harness(async()=>planned);await h.review.open();assert.equal(h.panes[0].video.muted,false);assert.equal(h.panes[1].video.muted,true);
  h.panes[1].video.muted=false;h.panes[1].video.dispatchEvent(new Event("volumechange"));assert.equal(h.nodes['[name="listen"]'].value,"B");assert.equal(h.panes[0].video.muted,true);assert.equal(h.panes[1].video.muted,false);
  h.panes[1].video.muted=true;h.panes[1].video.dispatchEvent(new Event("volumechange"));assert.equal(h.nodes['[name="listen"]'].value,"silent");
});

test("linked playback rates follow native controls and independent mode still starts both takes",async()=>{
  const h=harness(async()=>planned);await h.review.open();h.panes[0].video.playbackRate=2;h.panes[0].video.dispatchEvent(new Event("ratechange"));assert.equal(h.panes[1].video.playbackRate,2);
  h.nodes['[name="sync"]'].checked=false;h.panes[1].video.playbackRate=1;h.panes[1].video.dispatchEvent(new Event("ratechange"));assert.equal(h.panes[0].video.playbackRate,2);h.button("play").click();await settle();assert.ok(h.panes.every(pane=>!pane.video.paused));await h.review.open();assert.ok(h.panes.every(pane=>pane.video.playbackRate===1));
});
