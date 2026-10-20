export const MAX_CAPTURE_BYTES=64*1024*1024;
export const microphoneInput=async(constraints)=>({stream:await navigator.mediaDevices.getUserMedia(constraints)});

export function captureWav(blob,sampleRate,channels,frames) {
  const header=new ArrayBuffer(58),view=new DataView(header),text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,"RIFF");view.setUint32(4,50+blob.size,true);text(8,"WAVEfmt ");view.setUint32(16,18,true);view.setUint16(20,3,true);view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels*4,true);view.setUint16(32,channels*4,true);view.setUint16(34,32,true);view.setUint16(36,0,true);text(38,"fact");view.setUint32(42,4,true);view.setUint32(46,frames,true);text(50,"data");view.setUint32(54,blob.size,true);
  return new Blob([header,blob],{type:"audio/wav"});
}

export async function createCapture({signal,onChunk,onDone,onError,channels=1,deviceId="",monitor=false,getInput=microphoneInput,Context=globalThis.AudioContext,Worklet=globalThis.AudioWorkletNode}) {
  let input=null,context=null,source=null,node=null,finished=false,resolveDone;
  const done=new Promise((resolve)=>{resolveDone=resolve;});
  async function close() {
    node?.disconnect();source?.disconnect();
    input?.stream.getTracks().forEach((track)=>track.stop());await input?.dispose?.();
    if(context && context.state!=="closed")await context.close();
  }
  const check=()=>{if(signal.aborted)throw new DOMException("Capture canceled","AbortError");};
  try {
    if(!Context || !Worklet || new Uint8Array(new Float32Array([1]).buffer)[3]!==0x3f)throw new Error("Audio capture is unavailable in this browser");
    check();input=await getInput({video:false,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,sampleRate:{ideal:48000},channelCount:{ideal:channels},...(deviceId?{deviceId:{exact:deviceId}}:{})}});check();
    context=new Context({sampleRate:48000});await context.audioWorklet.addModule("/js/capture-worklet.js");check();await context.resume();check();
    const maxFrames=Math.min(300*context.sampleRate,Math.floor(MAX_CAPTURE_BYTES/(4*channels)));
    node=new Worklet(context,"venturi-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:channels,channelCountMode:"explicit",processorOptions:{channels,maxFrames}});
    node.port.onmessage=({data})=>{
      if(data.kind==="chunk")onChunk(data);
      else if(data.kind==="done" && !finished){finished=true;resolveDone(data);onDone?.(data);}
    };
    node.onprocessorerror=()=>{onError?.("Audio capture stopped unexpectedly; the captured part is retained");};
    source=context.createMediaStreamSource(input.stream);source.connect(node);node.connect(context.destination);if(monitor)source.connect(context.destination);
    for(const track of input.stream.getAudioTracks())track.addEventListener("ended",()=>onError?.("The audio input disconnected; the captured part is retained"),{once:true});
    return {sampleRate:context.sampleRate,channels,inputLatency:context.baseLatency || 0,start(){check();node.port.postMessage({kind:"start"});},async stop(){if(!finished)node.port.postMessage({kind:"stop"});let timer;try{return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Audio capture flush timed out; captured chunks are retained")),2000);})]);}finally{clearTimeout(timer);}},close};
  }catch(error){await close();throw error;}
}
