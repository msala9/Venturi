import {CaptureBuffer} from "./capture-buffer.js";

class VenturiCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();this.active=false;this.segment=0;
    this.capture=new CaptureBuffer({...options.processorOptions,onChunk:(value)=>this.port.postMessage({kind:"chunk",...value},[value.buffer]),onHold:(value)=>{this.active=false;this.port.postMessage({kind:'held',segment:this.segment,...value});},onDone:(value)=>{this.active=false;this.port.postMessage({kind:"done",...value});}});
    this.port.onmessage=({data})=>{
      if(['start','resume'].includes(data.kind) && !this.capture.finished){this.segment=data.segment;this.active=this.capture.resume(data.untilFrames ?? this.capture.maxFrames);}
      else if(data.kind==='hold'){this.segment=data.segment;this.active=false;this.capture.hold();}
      else if(data.kind==="stop")this.capture.stop();
    };
  }
  process(inputs) {
    // The output stays silent to avoid microphone feedback.
    if(this.active)this.capture.push(inputs[0] || []);return true;
  }
}
registerProcessor("venturi-capture",VenturiCapture);
