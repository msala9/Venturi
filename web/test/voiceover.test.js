import test from "node:test";
import assert from "node:assert/strict";
import {createVoiceover,voiceoverIdentity,voiceoverPlacement} from "../js/voiceover.js";

test("voiceover placement remains bound to the captured native revision and armed tracks while transport advances",()=>{
  const target={project_epoch:"epoch",generation:"2",timeline_id:"1",revision:"revision",start_frame:12,tracks:["2","1"]};
  assert.equal(voiceoverIdentity(target),voiceoverIdentity({...target,start_frame:50,tracks:["1","2"]}));
  assert.notEqual(voiceoverIdentity(target),voiceoverIdentity({...target,generation:"3"}));assert.notEqual(voiceoverIdentity(target),voiceoverIdentity({...target,tracks:["1"]}));
  assert.deepEqual(voiceoverPlacement("take",target,12,2,false),{kind:"place_recording",placement:{recording_id:"take",tracks:["2","1"],start_frame:12,latency_frames:2,overwrite:false}});
  for(const [start,latency] of [[-1,0],[1.5,0],[12,241],[NaN,0]])assert.throws(()=>voiceoverPlacement("take",target,start,latency,false));
});

class Control extends EventTarget {
  constructor(value=""){super();this.value=value;this.hidden=false;this.disabled=false;this.checked=false;this.textContent="";}
  click(){if(!this.disabled)this.dispatchEvent(new Event("click"));}
  replaceChildren(){}
  append(){}
  pause(){}
  removeAttribute(name){delete this[name];}
}
function harness(options={}) {
  globalThis.window=new EventTarget();globalThis.Option=class {constructor(label,value){this.label=label;this.value=value;}};
  const selectors=["output","[data-voice-start]","[data-voice-stop]","[data-voice-save]","[data-voice-apply]","[data-voice-rebind]","[data-voice-close]","[data-voice-discard]","form","audio","[data-voice-download]","[data-voice-backup]","meter"];
  const nodes=Object.fromEntries(selectors.map(selector=>[selector,new Control()])),root=new Control();root.querySelector=(selector)=>nodes[selector];root.showModal=()=>{root.open=true;};root.close=()=>{root.open=false;};
  const form=nodes.form;form.reportValidity=()=>true;form.elements=Object.fromEntries(["device","channels","format","playback","monitor","start","latency","overwrite"].map(name=>[name,new Control()]));form.elements.channels.value="1";form.elements.latency.value="0";
  const target={project_epoch:"epoch",generation:"1",timeline_id:"1",revision:"rev",start_frame:12,tracks:["1"],formats:[{id:"wav",label:"WAV"}],canPlayback:false};
  const video=new Control();video.paused=true;const uploads=[],commits=[],lifecycle={started:0,closed:0},samples=new Float32Array([0.1,0.2,0.3,0.4,0.5]);
  const captureFactory=async({onChunk,onDone})=>({sampleRate:48000,channels:1,start(){lifecycle.started++;},async stop(){if(lifecycle.started)onChunk({buffer:samples.buffer,frames:5,peak:0.5});onDone();},async close(){lifecycle.closed++;}});
  const fetcher=async(url,request)=>{uploads.push({url,request});const id=url.split('/recordings/')[1].split('?')[0];return{ok:true,json:async()=>({id,frames:5,sample_rate:48000,channels:1,format:"wav",path_token:`Voiceover-${id}.wav`})};};
  const voice=createVoiceover({root,getTarget:()=>target,getClientId:()=>"client",canCommit:()=>true,commit:async(operation)=>{commits.push(operation);},playback:{video,start:async()=>{},pause(){}},notice(){},captureFactory,fetcher,...options});
  return{voice,root,nodes,target,uploads,commits,lifecycle,video,form,button:(name)=>nodes[`[data-voice-${name}]`]};
}
async function settle(){for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));}

test("voiceover retains the final chunk across an interrupted upload and clears stale preview after placement",async()=>{
  let failed=true;const uploads=[];
  const retryHarness=harness({api:async()=>{throw Error("Recording not found");},fetcher:async(url,request)=>{uploads.push({url,request});if(failed){failed=false;throw new TypeError("Connection lost");}return{ok:true,json:async()=>({id:url.split('/recordings/')[1].split('?')[0],frames:5,sample_rate:48000,channels:1,format:"wav",path_token:"saved.wav"})};}});
  await retryHarness.voice.open();retryHarness.button("start").click();await settle();retryHarness.button("stop").click();await settle();
  assert.match(retryHarness.nodes.output.textContent,/take retained locally/);assert.equal(retryHarness.button("start").disabled,true);assert.equal(retryHarness.nodes["[data-voice-backup]"].hidden,false);assert.equal(retryHarness.button("apply").disabled,true);
  retryHarness.button("save").click();await settle();assert.equal(uploads.length,2);assert.equal(uploads[0].url,uploads[1].url);assert.equal(uploads[1].request.body.size,20);assert.equal(retryHarness.button("apply").disabled,false);assert.equal(retryHarness.lifecycle.closed,1);
  retryHarness.button("apply").click();await settle();assert.equal(retryHarness.commits.length,1);assert.equal(retryHarness.root.open,false);await retryHarness.voice.open();assert.equal(retryHarness.nodes.audio.hidden,true);assert.equal(retryHarness.nodes["[data-voice-download]"].hidden,true);assert.equal(retryHarness.nodes["[data-voice-backup]"].hidden,true);
});

test("a retained take requires explicit rebinding after a native document change",async()=>{
  const h=harness();await h.voice.open();h.button("start").click();await settle();h.button("stop").click();await settle();h.target.revision="new-revision";h.voice.invalidate();assert.equal(h.button("apply").disabled,true);h.button("apply").click();await settle();assert.equal(h.commits.length,0);
  h.target.start_frame=84;h.button("rebind").click();assert.equal(h.button("apply").disabled,false);h.button("apply").click();await settle();assert.equal(h.commits[0].placement.start_frame,84);
});

test("canceling preparation prevents a late programme result from starting capture",async()=>{
  let prepared;const h=harness({playback:{video:new Control(),start:()=>new Promise(resolve=>{prepared=resolve;}),pause(){}}});h.target.canPlayback=true;
  await h.voice.open();h.button("start").click();await settle();assert.equal(h.button("start").disabled,true);h.button("stop").click();await settle();prepared();await settle();assert.equal(h.lifecycle.started,0);assert.equal(h.lifecycle.closed,1);assert.equal(h.uploads.length,0);
});

test("a programme failure after playback begins still saves the captured final chunk",async()=>{
  const video=new Control();video.paused=false;const h=harness({playback:{video,start:async()=>{video.dispatchEvent(new Event("playing"));throw Error("Programme disconnected");},pause(){}}});h.target.canPlayback=true;
  await h.voice.open();h.button("start").click();await settle();assert.equal(h.lifecycle.started,1);assert.equal(h.lifecycle.closed,1);assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].request.body.size,20);assert.equal(h.button("apply").disabled,false);
});

test("unsaved take discard can be canceled and saved audio is retained on the server",async()=>{
  let allow=false;const h=harness({api:async()=>{throw Error("No receipt");},fetcher:async()=>{throw Error("Offline");},confirmDiscard:()=>allow});await h.voice.open();h.button("start").click();await settle();h.button("stop").click();await settle();
  h.button("discard").click();assert.equal(h.button("start").disabled,true);allow=true;h.button("discard").click();assert.equal(h.button("start").disabled,false);assert.equal(h.nodes["[data-voice-backup]"].hidden,true);assert.match(h.nodes.output.textContent,/Unsaved take discarded/);
  const saved=harness({confirmDiscard:()=>{throw Error("Saved audio must not be deleted");}});await saved.voice.open();saved.button("start").click();await settle();saved.button("stop").click();await settle();saved.button("discard").click();assert.match(saved.nodes.output.textContent,/saved audio remains/);assert.equal(saved.uploads.length,1);assert.equal(saved.button("start").disabled,false);
});
