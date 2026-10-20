export function renderMixer(root, timeline, { writable, commit, notice, open = false }) {
  const section=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Audio mixer";section.open=open;section.append(summary);
  const tracks=timeline.tracks.filter((track)=>track.kind === "audio").map((track)=>({channel:track.id,label:track.label || track.id,locked:track.locked,...track.mix}));
  tracks.push({channel:"master",label:"Master",locked:false,...timeline.master});
  for(const track of tracks) {
    const form=document.createElement("form"),heading=document.createElement("strong");heading.textContent=track.label;form.append(heading);
    const inputs={};
    for(const [key,label,min,max] of [["gain_db","Gain dB",-100,30],["pan","Balance L/R",-1,1]]) {
      const row=document.createElement("label");row.className="field";row.textContent=`${track.label} ${label}`;
      const input=document.createElement("input");input.type="number";input.step="any";input.min=min;input.max=max;input.value=track[key];input.disabled=!writable || track.locked;input.required=true;inputs[key]=input;
      row.append(input);form.append(row);
    }
    const button=document.createElement("button");button.textContent=`Apply ${track.label} mix`;button.disabled=!writable || track.locked;form.append(button);
    form.addEventListener("submit",(event)=>{event.preventDefault();if(form.reportValidity())commit({kind:"set_mixer",channel:track.channel,gain_db:Number(inputs.gain_db.value),pan:Number(inputs.pan.value)}).catch((error)=>notice(error.message));});
    section.append(form);
  }
  const note=document.createElement("p");note.className="muted";note.textContent="Native timeline mix. Source playback uses the original source audio. Level meters and insert effects are not connected yet.";section.append(note);
  root.append(section);return section;
}
