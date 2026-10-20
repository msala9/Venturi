import {CaptureBuffer} from "./capture-buffer.js";

class VenturiCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();this.active=false;
    this.capture=new CaptureBuffer({...options.processorOptions,onChunk:(value)=>this.port.postMessage({kind:"chunk",...value},[value.buffer]),onDone:(value)=>{this.active=false;this.port.postMessage({kind:"done",...value});}});
    this.port.onmessage=({data})=>{if(data.kind==="start" && !this.capture.finished)this.active=true;else if(data.kind==="stop")this.capture.stop();};
  }
  process(inputs) {
    // The output stays silent to avoid microphone feedback.
    if(this.active)this.capture.push(inputs[0] || []);return true;
  }
}
registerProcessor("venturi-capture",VenturiCapture);
