import test from "node:test";
import assert from "node:assert/strict";
import {CaptureBuffer} from "../js/capture-buffer.js";
import {captureWav,createCapture} from "../js/capture.js";

test("capture packetization preserves stereo samples and a short final tail without padding",()=>{
  const chunks=[],done=[];const capture=new CaptureBuffer({channels:2,maxFrames:100,onChunk:(value)=>chunks.push(value),onDone:(value)=>done.push(value),chunkFrames:4});
  capture.push([new Float32Array([1,2,3]),new Float32Array([4,5,6])]);capture.push([new Float32Array([7,8]),new Float32Array([9,10])]);capture.stop();capture.stop();
  assert.deepEqual(chunks.flatMap((chunk)=>Array.from(new Float32Array(chunk.buffer))),[1,4,2,5,3,6,7,9,8,10]);assert.equal(chunks[1].buffer.byteLength,8);assert.deepEqual(done,[{frames:5,reason:"stopped"}]);
});
test("capture honors its sample budget with variable quantum lengths and emits one completion",()=>{
  const chunks=[],done=[];const capture=new CaptureBuffer({channels:1,maxFrames:5,onChunk:(value)=>chunks.push(value),onDone:(value)=>done.push(value),chunkFrames:4});
  capture.push([new Float32Array([1,2])]);capture.push([new Float32Array([3,4,5,6,7])]);capture.push([new Float32Array([8])]);capture.stop();
  assert.deepEqual(chunks.flatMap((chunk)=>Array.from(new Float32Array(chunk.buffer))),[1,2,3,4,5]);assert.deepEqual(done,[{frames:5,reason:"limit"}]);
});
test("a late input-permission result after cancellation releases every track without creating an audio graph",async()=>{
  let resolveInput,stopped=0,graphs=0;const controller=new AbortController();
  const pending=createCapture({signal:controller.signal,onChunk(){},getInput:()=>new Promise((resolve)=>{resolveInput=resolve;}),Context:class{constructor(){graphs++;}},Worklet:class{}});
  controller.abort();resolveInput({stream:{getTracks:()=>[{stop(){stopped++;}}]}});
  await assert.rejects(pending,{name:"AbortError"});assert.equal(stopped,1);assert.equal(graphs,0);
});
test("a local capture backup is a bounded IEEE-float WAV with the exact unpadded sample payload",async()=>{
  const samples=new Float32Array([0.1,-0.2,0.3,-0.4]),blob=new Blob([samples.buffer]);const wav=captureWav(blob,48000,2,2);const bytes=await wav.arrayBuffer();const view=new DataView(bytes);
  assert.equal(wav.type,"audio/wav");assert.equal(wav.size,58+samples.byteLength);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),"RIFF");assert.equal(view.getUint16(20,true),3);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),48000);assert.equal(view.getUint32(46,true),2);assert.deepEqual(Array.from(new Float32Array(bytes.slice(58))),Array.from(samples));
});
