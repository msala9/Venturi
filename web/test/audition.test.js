import test from "node:test";
import assert from "node:assert/strict";
import {createAudioScrub} from "../js/audition.js";
const turn=()=>new Promise(resolve=>setTimeout(resolve,10));
function fixture() {
  let state={project_epoch:"p",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:640};
  const pending=[],played=[],handlers={};
  const enabled={checked:true,addEventListener:(name,fn)=>handlers[name]=fn},status={textContent:""};
  const scrub=createAudioScrub({enabled,status,getState:()=>state,delay:0,fetcher:()=>new Promise(resolve=>pending.push(resolve)),contextFactory:()=>({resume:async()=>{},decodeAudioData:async()=>({duration:.08}),destination:{},createBufferSource:()=>({connect(){},start(){played.push("start");},stop(){played.push("stop");}})})});
  const response={ok:true,arrayBuffer:async()=>new ArrayBuffer(15404)};
  return {scrub,pending,played,enabled,status,handlers,response,setState:next=>state=next};
}
test("audio scrub suppresses obsolete responses, stops on a new gesture and respects opt-out",async()=>{
  const f=fixture();f.scrub.request();await turn();f.scrub.request();await turn();
  f.pending[0](f.response);await turn();assert.deepEqual(f.played,[]);
  f.pending[1](f.response);await turn();assert.deepEqual(f.played,["start"]);
  f.scrub.stop();assert.deepEqual(f.played,["start","stop"]);
  f.enabled.checked=false;f.scrub.request();await turn();assert.equal(f.pending.length,2);
});
test("audio from a changed document or a disabled Program context never plays",async()=>{
  const f=fixture();f.scrub.request();await turn();f.setState(null);f.pending[0](f.response);await turn();assert.deepEqual(f.played,[]);
  f.scrub.request();await turn();assert.equal(f.pending.length,1);
});
test("audio failures remain visible and oversized fragments are refused",async()=>{
  const f=fixture();f.scrub.request();await turn();f.pending[0]({ok:false,json:async()=>({error:{message:"Audio busy"}})});await turn();assert.equal(f.status.textContent,"Audio busy");
  f.scrub.request();await turn();f.pending[1]({ok:true,arrayBuffer:async()=>new ArrayBuffer(16001)});await turn();assert.match(f.status.textContent,/budget/);assert.deepEqual(f.played,[]);
});
test("a rejected browser audio resume reports the problem without requesting server audio",async()=>{
  const status={textContent:""};let requests=0;
  const scrub=createAudioScrub({enabled:{checked:true,addEventListener(){}},status,getState:()=>({frame:1}),delay:0,fetcher:()=>{requests++;},contextFactory:()=>({resume:()=>Promise.reject(new Error("Output denied"))})});
  scrub.request();await turn();assert.equal(requests,0);assert.equal(status.textContent,"Output denied");scrub.stop();
});
