import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogMenu} from '../js/catalog-menu.js';

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, values = {}) {
    const event = {target: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...values};
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
}

class Element extends Target {
  constructor(tag, documentRef) {
    super();
    this.tag = tag;
    this.ownerDocument = documentRef;
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.isConnected = true;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
    this.isConnected = false;
  }
  contains(target) { return this === target || this.children.some(node => node.contains(target)); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getBoundingClientRect() { return {left: 20, top: 30, bottom: 55, width: 180, height: 25}; }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector.split(',').some(part => part === node.tag || part === '[tabindex]' && Number.isFinite(node.tabIndex))) return node;
      node = node.parentElement;
    }
    return null;
  }
  select() { this.allSelected = true; }
  click() { if (!this.disabled) this.fire('click'); }
  all() { return [this, ...this.children.flatMap(node => node.all())]; }
}

function harness() {
  const documentRef = new Target();
  const windowRef = new Target();
  Object.assign(windowRef, {innerWidth: 640, innerHeight: 480});
  documentRef.defaultView = windowRef;
  documentRef.querySelector = () => documentRef.modal ? {} : null;
  documentRef.createElement = tag => new Element(tag, documentRef);
  documentRef.body = new Element('body', documentRef);
  const root = new Element('div', documentRef);
  const row = new Element('button', documentRef);
  root.append(row);
  documentRef.body.append(root);
  row.focus();
  let value = {project_epoch: 'epoch', generation: '0', writable: true,
    snapshot: {media: [{id: '1', name: '<file>.mp4'}, {id: '2', name: 'Timeline', compound_timeline_id: '9'}],
      folders: [{id: 'f', name: 'Folder', parent: null}]},
    selected: ['1', '2'], selectedFolder: null, backgroundFolder: 'f'};
  const actions = [], notices = [];
  const controller = createCatalogMenu({root, getContext: () => value,
    onAction: action => actions.push(action), notice: message => notices.push(message)});
  const nodes = () => documentRef.body.all();
  const menu = () => nodes().find(node => node.className === 'catalog-context-menu');
  const input = () => nodes().find(node => node.className === 'catalog-rename-input');
  const button = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const open = (kind, id, options = {}) => controller.open({kind, id, x: 600, y: 450, event: {target: row}, ...options});
  return {documentRef, windowRef, root, row, actions, notices, controller, nodes, menu, input, button, open,
    context: () => value, set: next => { value = {...value, ...next}; }};
}

test('native media menus preserve selection, expose compound actions and never offer media deletion', () => {
  const h = harness();
  assert.equal(h.open('media', '1'), true);
  assert.deepEqual(h.context().selected, ['1', '2']);
  assert.equal(h.button('Rename'), undefined);
  assert.equal(h.button('Delete'), undefined);
  assert.equal(h.menu().attrs['aria-label'], '<file>.mp4 actions');
  assert.equal(h.menu().dataset.clipboardOwner, 'pool');
  h.button('Relink 2 selected media').click();
  assert.deepEqual(h.actions, [{kind: 'relink', media_ids: ['1', '2']}]);
  assert.equal(h.menu(), undefined);
  h.open('media', '2');
  h.button('Duplicate timeline').click();
  assert.deepEqual(h.actions.at(-1), {kind: 'duplicate_timeline', id: '2'});
  h.open('media', '2');
  h.button('Rename').click();
  assert.deepEqual(h.actions.at(-1), {kind: 'begin_rename', target_kind: 'media', id: '2'});
  h.controller.dispose();
});

test('folder menus target their own ID and background Timelines submenu owns navigation keys', () => {
  const h = harness();
  h.open('folder', 'f');
  h.button('Delete folder').click();
  assert.deepEqual(h.actions, [{kind: 'delete_folder', id: 'f'}]);
  assert.deepEqual(h.context().selected, ['1', '2']);
  h.open('background');
  h.button('New folder').click();
  assert.deepEqual(h.actions.at(-1), {kind: 'new_folder', parent: 'f'});
  h.open('background');
  const menu = h.menu(), trigger = h.button('Timelines ▸');
  trigger.focus();
  const right = menu.fire('keydown', {target: trigger, key: 'ArrowRight'});
  assert.equal(right.defaultPrevented, true);
  assert.equal(right.stopped, true);
  assert.equal(h.documentRef.activeElement, h.button('New timeline'));
  const end = menu.fire('keydown', {target: h.button('New timeline'), key: 'End'});
  assert.equal(end.defaultPrevented, true);
  assert.equal(h.documentRef.activeElement, h.button('Import OTIO'));
  menu.fire('keydown', {target: h.button('Import OTIO'), key: 'Enter'});
  assert.deepEqual(h.actions.at(-1), {kind: 'import_otio'});
  assert.equal(h.menu(), undefined);
  h.controller.dispose();
});

test('stale epoch/generation/snapshot/selection and read-only menus cannot dispatch', () => {
  for (const change of [
    h => h.set({project_epoch: 'other'}),
    h => h.set({generation: '1'}),
    h => h.set({snapshot: {...h.context().snapshot}}),
    h => h.set({selected: ['2']}),
    h => h.set({selectedFolder: 'f'}),
    h => h.set({presentation: 'grid'}),
    h => h.set({writable: false}),
    h => { h.root.isConnected = false; },
    h => { h.documentRef.modal = true; },
  ]) {
    const h = harness();
    h.open('media', '1');
    const action = h.button('Add to Library');
    change(h);
    action.click();
    assert.deepEqual(h.actions, []);
    assert.equal(h.menu(), undefined);
    h.controller.dispose();
  }
  const h = harness();
  h.set({writable: false});
  h.open('folder', 'f');
  assert.equal(h.button('Delete folder').disabled, true);
  h.button('Delete folder').click();
  assert.deepEqual(h.actions, []);
  h.controller.dispose();
});

test('outside dismissal preserves background activation, Escape restores focus, and disposal removes listeners', () => {
  const h = harness();
  h.open('media', '1');
  const outside = new Element('button', h.documentRef);
  const event = h.documentRef.fire('pointerdown', {target: outside});
  assert.equal(h.menu(), undefined);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
  h.open('media', '1', {keyboard: true});
  const escape = h.menu().fire('keydown', {key: 'Escape'});
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(h.documentRef.activeElement, h.row);
  for (const [target, type] of [[h.documentRef, 'scroll'], [h.windowRef, 'blur'], [h.windowRef, 'resize']]) {
    h.open('media', '1');
    target.fire(type);
    assert.equal(h.menu(), undefined);
  }
  h.open('folder', 'f');
  const retained = h.button('Delete folder');
  h.controller.dispose();
  retained.click();
  assert.deepEqual(h.actions, []);
  assert.equal(h.open('folder', 'f'), false);
  for (const callbacks of h.documentRef.listeners.values()) assert.equal(callbacks.size, 0);
});

test('rename is a separate input, trims once, suppresses shortcuts and commits once on Enter or blur', () => {
  const h = harness();
  assert.equal(h.controller.rename({kind: 'folder', id: 'f', element: h.row, name: 'Folder'}), true);
  const input = h.input();
  assert.equal(input.parentElement.tag, 'div');
  assert.equal(input.parentElement.dataset.clipboardOwner, 'pool');
  assert.equal(input.parentElement.style.height, '25px');
  assert.equal(input.allSelected, true);
  assert.equal(h.documentRef.activeElement, input);
  const shortcut = input.fire('keydown', {key: 'z', ctrlKey: true});
  assert.equal(shortcut.stopped, true);
  input.value = '  Revised folder  ';
  const enter = input.fire('keydown', {key: 'Enter'});
  assert.equal(enter.defaultPrevented, true);
  assert.equal(h.documentRef.activeElement, h.row);
  input.fire('blur');
  assert.deepEqual(h.actions, [{kind: 'rename', target_kind: 'folder', id: 'f', name: 'Revised folder'}]);
  h.controller.rename({kind: 'media', id: '2', element: h.row, name: 'Timeline'});
  h.input().value = 'Timeline two';
  h.input().fire('blur');
  assert.deepEqual(h.actions.at(-1), {kind: 'rename', target_kind: 'media', id: '2', name: 'Timeline two'});
  assert.equal(h.controller.rename({kind: 'media', id: '1', element: h.row, name: '<file>.mp4'}), false);
  h.controller.dispose();
});

test('long-name input scrolling preserves rename while scrolling its Media viewport cancels it', () => {
  const h = harness();
  h.controller.rename({kind: 'media', id: '2', element: h.row, name: 'A long timeline name'});
  const input = h.input();
  input.value = 'Revised timeline';
  h.documentRef.fire('scroll', {target: input});
  assert.equal(h.input(), input);
  assert.equal(h.documentRef.activeElement, input);
  input.fire('keydown', {key: 'Enter'});
  assert.deepEqual(h.actions, [{kind: 'rename', target_kind: 'media', id: '2', name: 'Revised timeline'}]);
  h.controller.rename({kind: 'media', id: '2', element: h.row});
  h.documentRef.fire('scroll', {target: h.root});
  assert.equal(h.input(), undefined);
  h.controller.dispose();
});

test('rename cancel, unchanged/empty/UTF-8-invalid values and stale or detached owners never write', () => {
  for (const value of ['', '   ', 'Folder', 'é'.repeat(65), 'bad\nname']) {
    const h = harness();
    h.controller.rename({kind: 'folder', id: 'f', element: h.row, name: 'Folder'});
    h.input().value = value;
    h.input().fire('blur');
    assert.deepEqual(h.actions, []);
    h.controller.dispose();
  }
  for (const change of [h => h.set({generation: '1'}), h => { h.row.isConnected = false; }]) {
    const h = harness();
    h.controller.rename({kind: 'folder', id: 'f', element: h.row});
    h.input().value = 'Changed';
    change(h);
    h.input().fire('blur');
    assert.deepEqual(h.actions, []);
    h.controller.dispose();
  }
  const h = harness();
  h.controller.rename({kind: 'folder', id: 'f', element: h.row});
  const input = h.input();
  input.value = 'Changed';
  input.fire('keydown', {key: 'Escape'});
  input.fire('blur');
  assert.deepEqual(h.actions, []);
  assert.equal(h.documentRef.activeElement, h.row);
  h.controller.dispose();
});
