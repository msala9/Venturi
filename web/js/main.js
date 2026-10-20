import {isTextTarget, installSplitter} from './ui.js';

const $ = id => document.getElementById(id);
const editor = $('editor');
export const notice = message => { $('notice').textContent = message; };
const panels = {
  Effects: ['Solid color','Title','Adjustment clip','Transitions · Push / Cross dissolve / Smooth cut','Masks · Rectangle / Ellipse / Path','Filters · Exposure / Blur / Shadow'],
  Library: ['Shared library','Compound clips','Import / Export OTIO'],
  Presets: ['Transform presets','Color presets','Equalizer presets','Compressor presets'],
  History: ['Undo history will appear after connecting to a project.'],
};
const workspaceTools = {
  Edit: [], Color: ['Shadows / Midtones / Highlights / Offset','Auto balance','Waveform / RGB parade / Vectorscope / Histogram','Curves'],
  Audio: ['Track / Master mixer','Six-band equalizer','Three-band compressor','Normalization / Mono','Voiceover','Analyze silence · VAD'],
  Review: ['Shot / Take grouping','Compare A/B','Replace Take','Prompt / Seed / Model metadata'],
};

function showWorkspace(name) {
  editor.dataset.workspace = name;
  document.querySelectorAll('[data-workspace]').forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', button.dataset.workspace === name);
  });
  const area = $('workspace-tools');
  area.replaceChildren(); area.hidden = name === 'Edit';
  const note = document.createElement('p'); note.className = 'muted';
  note.textContent = `${name} tools · Native features awaiting web integration`;
  area.append(note);
  const tools = document.createElement('div'); tools.className = 'tools';
  for (const label of workspaceTools[name]) {
    const button = document.createElement('button'); button.textContent = label;
    button.disabled = true; button.title = 'Not implemented in the web host'; tools.append(button);
  }
  area.append(tools);
  try { localStorage.setItem('workspace', name); } catch {}
}

document.querySelectorAll('button[data-workspace]').forEach(button => button.addEventListener('click', () => showWorkspace(button.dataset.workspace)));
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-panel]').forEach(tab => tab.setAttribute('aria-selected', tab === button));
  const name = button.dataset.panel;
  $('media-list').hidden = name !== 'Media'; $('search').parentElement.hidden = name !== 'Media';
  $('panel-content').hidden = name === 'Media'; $('panel-content').replaceChildren();
  for (const label of panels[name] || []) {
    const item = document.createElement('p'); item.textContent = label; $('panel-content').append(item);
  }
}));
$('projects-button').addEventListener('click', () => $('projects').showModal());
$('palette-button').addEventListener('click', () => $('palette').showModal());
$('export-button').addEventListener('click', () => { $('export-panel').hidden = false; });
$('close-export').addEventListener('click', () => { $('export-panel').hidden = true; });
$('collapse-inspector').addEventListener('click', () => { editor.classList.toggle('inspector-collapsed'); });
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewer').requestFullscreen(); } catch (error) { notice(error.message); }
});
for (const name of ['Edit','Color','Audio','Review']) {
  const button = document.createElement('button'); button.textContent = `${name} workspace`;
  button.addEventListener('click', () => { showWorkspace(name); $('palette').close(); }); $('command-list').append(button);
}
const restoreInspector = document.createElement('button'); restoreInspector.textContent = 'Show inspector';
restoreInspector.addEventListener('click', () => { editor.classList.remove('inspector-collapsed'); $('palette').close(); }); $('command-list').append(restoreInspector);
installSplitter($('left-splitter'), editor, '--left', 260);
installSplitter($('right-splitter'), editor, '--right', 280, -1);
installSplitter($('timeline-splitter'), editor, '--bottom', 300, -1);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !isTextTarget(event.target)) { event.preventDefault(); $('palette').showModal(); }
});
try { const name = localStorage.getItem('workspace'); if (workspaceTools[name]) showWorkspace(name); } catch {}

for (const [shot,take] of [['01 · Coast','A'],['01 · Coast','B'],['02 · Arrival','A']]) {
  const card = document.createElement('button'); card.className = 'media-item';
  card.textContent = `Fixture · Shot ${shot} / Take ${take}`;
  card.addEventListener('click', event => {
    if (!event.ctrlKey) document.querySelectorAll('.media-item').forEach(item => item.classList.remove('selected'));
    card.classList.toggle('selected');
  });
  $('media-list').append(card);
}
$('media-note').textContent = 'Demo Shot / Take labels · no media or server attached';
