export function createAudioScrub({ enabled, status, getState, getURL=query=>`/api/v1/preview/audio.wav?${new URLSearchParams(query)}`, fetcher=fetch, contextFactory=()=>new AudioContext(), delay=100 }) {
  let sequence=0, timer=null, controller=null, context=null, source=null;
  const identity=()=>JSON.stringify(getState());
  function stop() {
    sequence++;clearTimeout(timer);controller?.abort();controller=null;
    source?.stop();source=null;status.textContent="";
  }
  function request() {
    stop();
    const query=getState();
    if(!enabled.checked || !query)return;
    const seq=sequence, key=JSON.stringify(query);
    let ready;
    try {context ??=contextFactory();ready=context.resume();ready.catch(()=>{});} catch {status.textContent="Audio output unavailable";return;}
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try {
        await ready;
        if(seq!==sequence || key!==identity() || !enabled.checked)return;
        if(context.state && context.state!=="running")throw new Error("Audio output is suspended; seek again");
        const response=await fetcher(getURL(query),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),cache:"no-store"});
        if(seq!==sequence || key!==identity() || !enabled.checked)return;
        if(!response.ok) {const result=await response.json();throw new Error(result.error?.message || "Audio audition unavailable");}
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength>16000)throw new Error("Audio fragment exceeded its budget");
        const buffer=await context.decodeAudioData(bytes);
        if(seq!==sequence || key!==identity() || !enabled.checked)return;
        source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();
        status.textContent="Native audio · 80 ms";
      } catch(error) {
        if(seq===sequence && error.name!=="AbortError")status.textContent=error.message;
      }
    },delay);
  }
  enabled.addEventListener("change",stop);
  return {request,stop};
}
