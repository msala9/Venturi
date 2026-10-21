const empty = () => ({mark_in:null,mark_out:null});
function integer(value) {
  if(!Number.isSafeInteger(value))throw Error('Mark positions must be integer frames');
  return value;
}
function checked(marks={}) {
  const value={mark_in:marks.mark_in ?? null,mark_out:marks.mark_out ?? null};
  for(const frame of Object.values(value))if(frame!==null)integer(frame);
  return value;
}
const clamp=(frame,end)=>Math.max(0,Math.min(frame,end));
export function resolveMarkRange(marks,total) {
  const value=checked(marks),end=Math.max(0,integer(total));
  const out=clamp(value.mark_out ?? end,end);
  return {start_frame:clamp(value.mark_in ?? 0,out),end_frame:out};
}
export function setMarkIn(marks,frame,total) {
  const value=checked(marks);value.mark_in=clamp(integer(frame),Math.max(0,integer(total)));
  if(value.mark_out!==null && value.mark_out<=value.mark_in)value.mark_out=null;
  return value;
}
export function setMarkOut(marks,frame,total) {
  const value=checked(marks),end=Math.max(0,integer(total));
  value.mark_out=clamp(integer(frame)+1,end);
  if(value.mark_in!==null && value.mark_in>=value.mark_out)value.mark_in=null;
  return value;
}
export function markRangeContext(previous,epoch,timeline) {
  if(!epoch || !timeline)return {epoch:null,timeline:null,marks:empty()};
  return {epoch,timeline,marks:previous?.epoch===epoch && previous.timeline===timeline?checked(previous.marks):empty()};
}
export function markRangeAction(event,{textTarget=false,dialogOpen=false}={}) {
  if(event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.getModifierState?.('AltGraph') || textTarget || dialogOpen)return null;
  return event.key?.toLowerCase()==='i'?'in':event.key?.toLowerCase()==='o'?'out':null;
}
