export class CaptureBuffer {
  constructor({channels,maxFrames,onChunk,onDone,chunkFrames=4096}) {
    this.channels=channels;this.maxFrames=maxFrames;this.onChunk=onChunk;this.onDone=onDone;this.chunkFrames=chunkFrames;this.frames=0;this.position=0;this.peak=0;this.finished=false;this.buffer=new Float32Array(chunkFrames*channels);
  }
  push(input) {
    if(this.finished || !input[0]?.length)return;
    for(let index=0;index<input[0].length;index++) {
      if(this.frames>=this.maxFrames){this.stop("limit");return;}
      for(let channel=0;channel<this.channels;channel++){const value=input[channel]?.[index] ?? 0;this.buffer[this.position*this.channels+channel]=value;this.peak=Math.max(this.peak,Math.abs(value));}
      this.frames++;this.position++;if(this.position===this.chunkFrames)this.flush();
    }
    if(this.frames===this.maxFrames)this.stop("limit");
  }
  flush() {
    if(!this.position)return;
    const buffer=this.position===this.chunkFrames?this.buffer:this.buffer.slice(0,this.position*this.channels);
    this.onChunk({buffer:buffer.buffer,frames:this.frames,peak:this.peak});this.buffer=new Float32Array(this.chunkFrames*this.channels);this.position=0;this.peak=0;
  }
  stop(reason="stopped") {if(this.finished)return;this.flush();this.finished=true;this.onDone({frames:this.frames,reason});}
}
