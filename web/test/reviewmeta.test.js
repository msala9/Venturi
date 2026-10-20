import test from "node:test";
import assert from "node:assert/strict";
import {annotationEdit,annotationIdentity,filteredTakes,createReviewMetadata} from "../js/reviewmeta.js";

test("annotations bind Save As names and native generations independently of media selection",()=>{
  const context={document:{project_epoch:"epoch",project_name:"movie.vvproj",generation:"2"},selectedMedia:"1"};assert.equal(annotationIdentity(context),annotationIdentity({...context,selectedMedia:"2"}));for(const field of ["project_epoch","project_name","generation"])assert.notEqual(annotationIdentity(context),annotationIdentity({...context,document:{...context.document,[field]:"different"}}));assert.equal(annotationIdentity(null),null);
});
test("shot and metadata search keep exact seed strings and unassigned takes",()=>{
  const data={shots:{arrival:"Arrival"},items:[{media_id:"9007199254740993",shot_id:"arrival",source_name:"a.mp4",label:"B",metadata:{model:"Known",seed:"18446744073709551615",prompt:null}},{media_id:"2",shot_id:null,source_name:"other.wav",label:"",metadata:{}}]};assert.equal(filteredTakes(data,"arrival","18446744073709551615")[0].media_id,"9007199254740993");assert.equal(filteredTakes(data,"all","ARRIVAL").length,1);assert.equal(filteredTakes(data,"unassigned","")[0].media_id,"2");
});
test("annotation writes distinguish inherited provenance, explicit unknown fields and source rebinding",()=>{
  const item={media_id:"2"},values={shot_id:"arrival",label:"Take B",rating:"favorite",use_origin:false,seed:"9007199254740993",model:"known",prompt:"<tag>literal</tag>\nnew line",rebind:true};const edit=annotationEdit(item,values);assert.equal(edit.metadata.seed,"9007199254740993");assert.equal(edit.metadata.prompt,values.prompt);assert.equal(edit.rebind_source,true);assert.equal(annotationEdit(item,{...values,use_origin:true}).metadata,null);assert.deepEqual(annotationEdit(item,{...values,seed:"",model:"",prompt:"",rebind:false}).metadata,{model:null,prompt:null,seed:null});
});

class Control extends EventTarget {
  constructor(){super();this.value="";this.disabled=false;this.checked=false;this.children=[];this.dataset={};}
  replaceChildren(...children){this.children=children;}
  append(child){this.children.push(child);}
  setAttribute(){}
  querySelectorAll(){return [];}
  reportValidity(){return true;}
}
function harness(api,commit=async()=>{}){
  globalThis.Option=class{constructor(label,value){this.label=label;this.value=value;}};
  globalThis.document={createElement:()=>new Control()};
  const nodes=new Map(),root=new Control();root.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,new Control());return nodes.get(selector);};root.showModal=()=>{root.open=true;};root.close=()=>{root.open=false;};
  const context={document:{project_epoch:"epoch",project_name:"movie.vvproj",generation:"2"},selectedMedia:"1"},commits=[];let writable=true;
  const controller=createReviewMetadata({root,getContext:()=>context,canCommit:()=>writable,commit:async op=>{commits.push(op);await commit(op);},notice(){},onCompare(){},api});
  return {controller,context,commits,nodes,field:name=>root.querySelector(`[name="${name}"]`),button:name=>root.querySelector(`[data-annotation-${name}]`),submit:()=>nodes.get("form").dispatchEvent(new Event("submit",{cancelable:true})),setWritable:value=>{writable=value;}};
}
const saved={project_epoch:"epoch",project_token:"movie.vvproj",generation:"2",revision:"revision",shots:{},items:[{media_id:"1",source_name:"take.mp4",label:"",rating:"unrated",metadata:{},source_metadata:{},metadata_override:false}],orphans:[],can_restore_previous:false};
async function settle(){for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));}

test("late annotation reads cannot attach to a Save As namespace",async()=>{
  let resolve;const h=harness(()=>new Promise(done=>{resolve=done;})),opening=h.controller.open();h.context.document.project_name="copy.vvproj";resolve(saved);await opening;assert.equal(h.button("save").disabled,true);h.submit();await settle();assert.equal(h.commits.length,0);assert.match(h.nodes.get("[data-annotation-status]").textContent,/Project changed/);
});

test("annotation conflicts retain the exact draft and re-enable retry",async()=>{
  const h=harness(async()=>saved,async()=>{throw Error("Annotations changed");});await h.controller.open();h.field("take_label").value="Retained draft";h.field("use_origin").checked=false;h.field("seed").value="18446744073709551615";h.submit();await settle();assert.equal(h.commits.length,1);assert.equal(h.commits[0].revision,"revision");assert.equal(h.commits[0].edit.metadata.seed,"18446744073709551615");assert.equal(h.field("take_label").value,"Retained draft");assert.equal(h.button("save").disabled,false);assert.match(h.nodes.get("[data-annotation-status]").textContent,/current form retained/);
});

test("read-only and stale document forms cannot write annotations",async()=>{
  const h=harness(async()=>saved);await h.controller.open();h.setWritable(false);h.controller.invalidate();assert.equal(h.button("save").disabled,true);h.submit();await settle();assert.equal(h.commits.length,0);h.setWritable(true);h.context.document.generation="3";h.controller.invalidate();h.submit();await settle();assert.equal(h.commits.length,0);assert.equal(h.button("save").disabled,true);
});
