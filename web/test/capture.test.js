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

test('capture window ceilings flush exact tails without ending the take or accepting preparation samples',()=>{
  const chunks=[],done=[],held=[],capture=new CaptureBuffer({channels:1,maxFrames:12,chunkFrames:4,onChunk:value=>chunks.push(value),onDone:value=>done.push(value),onHold:value=>held.push(value)});
  capture.resume(3);capture.push([new Float32Array([1,2,3,99])]);assert.deepEqual(done,[]);assert.deepEqual(held,[{frames:3,reason:'window'}]);
  capture.push([new Float32Array([99,99])]);capture.resume(7);capture.push([new Float32Array([4,5])]);capture.hold();capture.push([new Float32Array([99])]);capture.resume(7);capture.push([new Float32Array([6,7,99])]);
  assert.deepEqual(chunks.flatMap(chunk=>Array.from(new Float32Array(chunk.buffer))),[1,2,3,4,5,6,7]);assert.equal(capture.frames,7);assert.deepEqual(done,[]);
  capture.stop();capture.resume(10);capture.push([new Float32Array([99])]);assert.deepEqual(done,[{frames:7,reason:'stopped'}]);assert.equal(capture.frames,7);
});

test('holding and resuming never resets the global finite capture budget',()=>{
  const done=[],capture=new CaptureBuffer({channels:1,maxFrames:5,onChunk(){},onDone:value=>done.push(value)});
  capture.resume(2);capture.push([new Float32Array([1,2,3])]);assert.equal(capture.finished,false);capture.resume(5);capture.push([new Float32Array([3,4,5,6])]);assert.deepEqual(done,[{frames:5,reason:'limit'}]);
  for(const frames of [-1,1.5,Infinity])assert.throws(()=>new CaptureBuffer({channels:1,maxFrames:5,onChunk(){},onDone(){}}).resume(frames));
});

test('the production capture worklet holds between windows and resumes the same unpadded take',async t=>{
  const previousProcessor=globalThis.AudioWorkletProcessor,previousRegister=globalThis.registerProcessor,messages=[];let Processor;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:value=>messages.push(value)};}};globalThis.registerProcessor=(name,value)=>{assert.equal(name,'venturi-capture');Processor=value;};
  t.after(()=>{globalThis.AudioWorkletProcessor=previousProcessor;globalThis.registerProcessor=previousRegister;});
  await import('../js/capture-worklet.js');const node=new Processor({processorOptions:{channels:1,maxFrames:12,chunkFrames:4}});
  node.port.onmessage({data:{kind:'start',segment:1,untilFrames:3}});node.process([[new Float32Array([1,2,3,99])]]);node.process([[new Float32Array([99])]]);
  assert.equal(messages.some(value=>value.kind==='done'),false);assert.deepEqual(messages.find(value=>value.kind==='held'),{kind:'held',segment:1,frames:3,reason:'window'});
  node.port.onmessage({data:{kind:'resume',segment:2,untilFrames:7}});node.process([[new Float32Array([4,5,6,7,99])]]);node.port.onmessage({data:{kind:'stop'}});
  assert.deepEqual(messages.filter(value=>value.kind==='chunk').flatMap(value=>Array.from(new Float32Array(value.buffer))),[1,2,3,4,5,6,7]);assert.deepEqual(messages.filter(value=>value.kind==='done'),[{kind:'done',frames:7,reason:'stopped'}]);
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
