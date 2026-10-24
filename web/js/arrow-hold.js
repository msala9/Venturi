export function programArrowContext({document,timeline,mode,frame,inputOwner='timeline',blocked=false}) {
  if(blocked || mode!=='program' || !document || !timeline || !Number.isSafeInteger(frame) || frame<0 || !Number.isSafeInteger(timeline.fps?.num) || timeline.fps.num<=0 || !Number.isSafeInteger(timeline.fps?.den) || timeline.fps.den<=0)return null;
  const identity=[document.project_epoch,document.generation,timeline.id,timeline.revision,inputOwner];
  if(identity.some(value=>typeof value!=='string' || !value))return null;
  return {identity:JSON.stringify(identity),frame,fps:{...timeline.fps}};
}

export function arrowHoldTarget(start,direction,elapsed,fps) {
  const extra=Math.floor(Math.max(0,elapsed/1000-0.3)*(fps.num/fps.den)*0.5);
  return Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,start+direction*(1+extra)));
}

export function createArrowHold({getState,onStart,onFrame,onSeek,onSettled,notice=()=>{},documentRef=globalThis.document,windowRef=globalThis.window,now=()=>performance.now(),requestFrame=callback=>windowRef.requestAnimationFrame(callback),cancelFrame=id=>windowRef.cancelAnimationFrame(id)}) {
  const pressed=new Set(),listeners=[];
  let hold=null,animation=null,sequence=0,queued=null,rendering=false,disposed=false,keyTarget=null,keyContext=null;
  const listen=(node,type,callback,options)=>{node?.addEventListener?.(type,callback,options);listeners.push(()=>node?.removeEventListener?.(type,callback,options));};
  const same=(owner,state=getState())=>!disposed && state && state.identity===owner.identity && state.fps.num===owner.fps.num && state.fps.den===owner.fps.den;
  const current=owner=>owner.sequence===sequence && same(owner) && getState()?.frame===owner.frame;
  function stopClock(){if(animation!==null)cancelFrame(animation);animation=null;hold=null;}
  function cancel(){sequence++;stopClock();pressed.clear();queued=null;keyTarget=null;keyContext=null;}
  async function drain(){
    if(rendering || !queued)return;
    const owner=queued;queued=null;if(!current(owner))return;rendering=true;
    try{await onSeek(owner.frame);if(current(owner))onSettled?.(owner.frame);}
    catch(error){if(current(owner))notice(error.message);}
    finally{rendering=false;void drain();}
  }
  function apply(owner,frame){
    if(frame===owner.frame)return;
    owner.frame=frame;onFrame(frame);queued={identity:owner.identity,fps:owner.fps,frame,sequence};void drain();
  }
  function tick(){
    animation=null;const owner=hold;if(!owner)return;
    if(!same(owner) || getState()?.frame!==owner.frame){cancel();return;}
    apply(owner,arrowHoldTarget(owner.start,owner.direction,now()-owner.time,owner.fps));
    if(hold===owner)animation=requestFrame(tick);
  }
  function direction(){return pressed.size===1?(pressed.has('ArrowLeft')?-1:1):null;}
  function start(){
    stopClock();const step=direction();if(step===null)return;
    if(!getState()){cancel();return;}
    onStart();const state=getState();if(!state){cancel();return;}
    sequence++;const owner={...state,sequence,start:state.frame,direction:step,time:now()};hold=owner;
    apply(owner,arrowHoldTarget(owner.start,step,0,owner.fps));animation=requestFrame(tick);
  }
  function keydown(event){
    if(!['ArrowLeft','ArrowRight'].includes(event.key) || event.defaultPrevented || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph'))return false;
    if(event.repeat)return pressed.has(event.key);
    if(pressed.has(event.key))return true;
    const state=getState();if(disposed || !state)return false;
    if(!pressed.size)keyContext=state;
    keyTarget=event.target;pressed.add(event.key);start();return true;
  }
  function keyup(event){if(!pressed.delete(event.key))return;stopClock();if(pressed.size){if(!same(keyContext)){cancel();return;}start();}else{keyTarget=null;keyContext=null;}}
  listen(documentRef,'keyup',keyup,true);
  listen(documentRef,'keydown',event=>{if(pressed.size && (!['ArrowLeft','ArrowRight'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing))cancel();},true);
  listen(documentRef,'pointerdown',cancel,true);
  listen(documentRef,'focusin',event=>{if(pressed.size && event.target!==keyTarget)cancel();},true);
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(documentRef,'toggle',()=>{if(documentRef.querySelector?.('dialog[open]'))cancel();},true);
  listen(windowRef,'blur',cancel);
  listen(windowRef,'pagehide',cancel);
  return {keydown,keyup,cancel,active:()=>Boolean(hold),dispose(){if(disposed)return;cancel();disposed=true;for(const remove of listeners)remove();}};
}
