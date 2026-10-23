const f=Math.fround;
export const MIXER_GAIN_CURVE=[[-100,0],[-60,.07],[-40,.16],[-30,.24],[-20,.34],[-12,.46],[-6,.58],[0,.7],[6,.8],[12,.88],[30,1]].map(pair=>pair.map(f));
const bounds={gain_db:[-100,30],pan:[-1,1]};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function interpolate(value,axis){
  const other=1-axis,x=f(clamp(value,MIXER_GAIN_CURVE[0][axis],MIXER_GAIN_CURVE.at(-1)[axis]));
  for(let index=1;index<MIXER_GAIN_CURVE.length;index++){
    const a=MIXER_GAIN_CURVE[index-1],b=MIXER_GAIN_CURVE[index];
    if(x<=b[axis]){const t=f(f(x-a[axis])/f(b[axis]-a[axis]));return f(a[other]+f(f(b[other]-a[other])*t));}
  }
  return MIXER_GAIN_CURVE.at(-1)[other];
}
export const mixerGainPosition=value=>interpolate(value,0);
export const mixerGainDb=value=>interpolate(value,1);
export function mixerControlDelta(kind,value,dx,dy,travel,fine=false){
  const scale=f(fine ? .1 : 1);
  if(kind==='gain_db')return mixerGainDb(f(mixerGainPosition(value)+f(f(f(-dy)/f(travel))*scale)));
  const position=f(f(f(value)+1)/2),moved=f(f(f(f(dx)-f(dy))/200)*scale);
  return f(f(clamp(f(position+moved),0,1)*2)-1);
}
export function bindMixerControl(element,{kind,value,canInteract=()=>true,getContext=()=>null,onStart=()=>{},onDraft=()=>{},onCancel=()=>{},onCommit,notice=()=>{},windowRef=globalThis.window,documentRef=globalThis.document}){
  const [min,max]=bounds[kind];let current=f(value),gesture=null,waiting=false,disposed=false;
  const listeners=[];
  const listen=(target,type,callback,options)=>{target?.addEventListener?.(type,callback,options);listeners.push(()=>target?.removeEventListener?.(type,callback,options));};
  const live=()=>!disposed && !waiting && element.isConnected!==false && !element.disabled && canInteract();
  const paint=()=>{
    const position=kind==='gain_db'?mixerGainPosition(current):f(f(current+1)/2);
    element.style?.setProperty('--mixer-position',`${position*100}%`);
    element.style?.setProperty('--mixer-angle',`${current*135}deg`);
    element.setAttribute('aria-valuenow',String(current));
    element.setAttribute('aria-valuetext',kind==='gain_db'?`${current.toFixed(2)} dB`:Math.abs(current)<.000001?'Center':`${Math.round(Math.abs(current)*100)}% ${current<0?'left':'right'}`);
  };
  function release(owner){try{if(element.hasPointerCapture?.(owner.id))element.releasePointerCapture(owner.id);}catch{}}
  function cancel(){if(!gesture)return;const owner=gesture;gesture=null;current=owner.value;release(owner);paint();onCancel();}
  const rectKey=rect=>JSON.stringify([rect.left,rect.top,rect.width,rect.height]);
  const valid=owner=>live() && owner.context===getContext() && owner.rect===rectKey(element.getBoundingClientRect());
  async function commit(before,context){
    if(current===before){onCancel();return;}
    if(!live() || context!==getContext()){current=before;paint();onCancel();return;}
    const next=current;waiting=true;element.setAttribute('aria-busy','true');
    try{await onCommit(next);}
    catch(error){current=before;if(!disposed){paint();onCancel();notice(error.message);}}
    finally{waiting=false;element.setAttribute('aria-busy','false');}
  }
  function move(event,releaseEvent=false){
    const owner=gesture;if(!owner || event.pointerId!==owner.id)return;
    if(!valid(owner) || (!releaseEvent && event.buttons!==undefined && !(event.buttons&1))){cancel();return;}
    const dx=event.clientX-owner.x,dy=event.clientY-owner.y;owner.x=event.clientX;owner.y=event.clientY;
    if(!dx && !dy)return;
    current=mixerControlDelta(kind,current,dx,dy,owner.travel,event.shiftKey);paint();onDraft(current);
  }
  listen(element,'pointerdown',event=>{
    if(event.button!==0 || event.isPrimary===false || gesture || !live())return;
    const rect=element.getBoundingClientRect();if(!Number.isFinite(rect.height) || rect.height<=18)return;
    event.preventDefault();element.focus();onStart();
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,value:current,context:getContext(),rect:rectKey(rect),travel:rect.height-18};
    try{element.setPointerCapture(event.pointerId);}catch{cancel();}
  });
  listen(element,'pointermove',move);
  listen(element,'pointerup',event=>{
    if(!gesture || event.pointerId!==gesture.id || event.button!==0)return;
    move(event,true);if(!gesture)return;const owner=gesture;gesture=null;release(owner);void commit(owner.value,owner.context);
  });
  for(const type of ['pointercancel','lostpointercapture'])listen(element,type,event=>{if(gesture && event.pointerId===gesture.id)cancel();});
  listen(element,'dblclick',event=>{
    if(!live())return;event.preventDefault();cancel();onStart();const before=current,context=getContext();current=0;paint();onDraft(current);void commit(before,context);
  });
  listen(element,'keydown',event=>{
    if([' ','Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)){event.stopPropagation();event.preventDefault();}else return;
    if(event.key==='Escape'){cancel();return;}if(event.key===' ' || !live() || gesture)return;
    const before=current,context=getContext(),direction=['ArrowUp','ArrowRight','PageUp'].includes(event.key)?1:-1;
    if(event.key==='Enter')current=0;
    else if(event.key==='Home')current=min;
    else if(event.key==='End')current=max;
    else current=f(clamp(current+direction*(kind==='gain_db' ? .2 : .01)*(event.shiftKey ? .1 : 1)*(event.key.startsWith('Page')?10:1),min,max));
    onStart();paint();onDraft(current);void commit(before,context);
  });
  listen(windowRef,'blur',cancel);listen(windowRef,'resize',cancel);listen(windowRef,'scroll',cancel,true);
  listen(documentRef,'visibilitychange',()=>{if(documentRef.hidden)cancel();});
  listen(element,'blur',cancel);
  element.setAttribute('role','slider');element.setAttribute('aria-valuemin',String(min));element.setAttribute('aria-valuemax',String(max));element.setAttribute('aria-orientation',kind==='gain_db'?'vertical':'horizontal');paint();
  return {cancel,dispose(){cancel();disposed=true;for(const remove of listeners)remove();}};
}
