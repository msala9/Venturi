import test from "node:test";
import assert from "node:assert/strict";
import {createPreviewCache} from "../js/preview-cache.js";

test("native cache strips discard late responses and disappear on document changes",async()=>{
  let state={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960};
  const pending=[],status={textContent:""};let paints=0;
  const cache=createPreviewCache({getState:()=>state,status,onChange:()=>paints++,fetcher:()=>new Promise(resolve=>pending.push(resolve))});
  const old=cache.refresh();state={...state,revision:"next"};const latest=cache.refresh();
  pending[1](Response.json({frames:[12,13],programs:[{id:"ready",start_frame:0,end_frame:48}]}));await latest;
  pending[0](Response.json({frames:[0],programs:[]}));await old;
  assert.deepEqual(cache.ranges().frames,[12,13]);assert.match(status.textContent,/2 frames · 1 movies/);
  state={...state,frame:24};assert.equal(cache.ranges().programs[0].end_frame,48);
  state={...state,if_generation:"1"};assert.deepEqual(cache.ranges(),{frames:[],programs:[]});
  assert.ok(paints>=3);
});

test("failed cache checks clear previously advertised frames",async()=>{
  const state={project_epoch:"p:1",if_generation:"0",timeline_id:"1",revision:"r",frame:0,width:960},status={textContent:""};let fail=false;
  const cache=createPreviewCache({getState:()=>state,status,onChange(){},fetcher:async()=>fail?new Response("",{status:409}):Response.json({frames:[0],programs:[]})});
  await cache.refresh();assert.deepEqual(cache.ranges().frames,[0]);fail=true;await cache.refresh();
  assert.deepEqual(cache.ranges().frames,[]);assert.match(status.textContent,/unavailable/);
});
