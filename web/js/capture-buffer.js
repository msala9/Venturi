export class CaptureBuffer {
  constructor({channels,maxFrames,onChunk,onDone,onHold,chunkFrames=4096}) {
    this.channels=channels;this.maxFrames=maxFrames;this.onChunk=onChunk;this.onDone=onDone;this.onHold=onHold;this.chunkFrames=chunkFrames;this.frames=0;this.position=0;this.peak=0;this.finished=false;this.held=false;this.untilFrames=maxFrames;this.buffer=new Float32Array(chunkFrames*channels);
  }
  push(input) {
    if(this.finished || this.held || !input[0]?.length)return;
    for(let index=0;index<input[0].length;index++) {
      if(this.frames>=this.maxFrames){this.stop("limit");return;}
      if(this.frames>=this.untilFrames){this.hold('window');return;}
      for(let channel=0;channel<this.channels;channel++){const value=input[channel]?.[index] ?? 0;this.buffer[this.position*this.channels+channel]=value;this.peak=Math.max(this.peak,Math.abs(value));}
      this.frames++;this.position++;if(this.position===this.chunkFrames)this.flush();
    }
    if(this.frames===this.maxFrames)this.stop("limit");else if(this.frames>=this.untilFrames)this.hold('window');
  }
  flush() {
    if(!this.position)return;
    const buffer=this.position===this.chunkFrames?this.buffer:this.buffer.slice(0,this.position*this.channels);
    this.onChunk({buffer:buffer.buffer,frames:this.frames,peak:this.peak});this.buffer=new Float32Array(this.chunkFrames*this.channels);this.position=0;this.peak=0;
  }
  stop(reason="stopped") {if(this.finished)return;this.flush();this.finished=true;this.onDone({frames:this.frames,reason});}
  hold(reason='held'){if(this.finished || this.held)return;this.held=true;this.flush();this.onHold?.({frames:this.frames,reason});}
  resume(untilFrames=this.maxFrames){
    if(this.finished)return false;
    if(!Number.isSafeInteger(untilFrames) || untilFrames<0 || untilFrames>this.maxFrames)throw Error('Choose a bounded capture window');
    this.untilFrames=untilFrames;this.held=false;
    if(this.frames>=this.maxFrames)this.stop('limit');else if(this.frames>=untilFrames)this.hold('window');
    return !this.finished && !this.held;
  }
}
