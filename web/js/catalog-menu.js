const textBytes = value => new TextEncoder().encode(value).length;

function capture(context) {
  if (!context) return null;
  return {
    epoch: context.project_epoch,
    generation: context.generation,
    snapshot: context.snapshot,
    media: context.snapshot?.media,
    folders: context.snapshot?.folders,
    selected: JSON.stringify(context.selected || []),
    selectedFolder: context.selectedFolder ?? null,
    backgroundFolder: context.backgroundFolder ?? null,
    presentation: context.presentation,
    writable: context.writable === true,
  };
}

function matches(owner, context) {
  const current = capture(context);
  return Boolean(owner && current
    && owner.epoch === current.epoch
    && owner.generation === current.generation
    && owner.snapshot === current.snapshot
    && owner.media === current.media
    && owner.folders === current.folders
    && owner.selected === current.selected
    && owner.selectedFolder === current.selectedFolder
    && owner.backgroundFolder === current.backgroundFolder
    && owner.presentation === current.presentation
    && owner.writable === current.writable);
}

export function createCatalogMenu({root, getContext, onAction, notice = () => {}}) {
  const documentRef = root.ownerDocument || globalThis.document;
  const windowRef = documentRef.defaultView || globalThis;
  let menu = null;
  let editor = null;
  let disposed = false;

  const context = () => {
    try { return getContext(); } catch { return null; }
  };
  const current = owner => !disposed && root.isConnected !== false
    && matches(owner, context()) && !documentRef.hidden
    && !documentRef.querySelector?.('dialog[open]');
  const restore = target => {
    if (!disposed && target?.isConnected !== false) target?.focus?.();
  };
  const focusTarget = target => target?.closest?.('button,[href],input,select,textarea,[tabindex]')
    || documentRef.activeElement || root;
  const report = error => {
    if (!disposed) notice(error?.message || 'The Media pool action failed');
  };
  const dispatch = action => {
    try { Promise.resolve(onAction(action)).catch(report); } catch (error) { report(error); }
  };

  function closeMenu(returnFocus = false) {
    const previous = menu;
    menu = null;
    previous?.element.remove();
    if (returnFocus && previous) restore(previous.focus);
  }

  function closeEditor(returnFocus = false) {
    const previous = editor;
    editor = null;
    previous?.element.remove();
    if (returnFocus && previous) restore(previous.focus);
  }

  function close() {
    closeMenu();
    closeEditor();
  }

  function position(element, x, y) {
    element.style.position = 'fixed';
    element.style.left = `${Math.max(0, Number.isFinite(x) ? x : 0)}px`;
    element.style.top = `${Math.max(0, Number.isFinite(y) ? y : 0)}px`;
    const bounds = element.getBoundingClientRect();
    const width = windowRef.innerWidth || documentRef.documentElement?.clientWidth;
    const height = windowRef.innerHeight || documentRef.documentElement?.clientHeight;
    if (width) element.style.left = `${Math.max(0, Math.min(x || 0, width - bounds.width))}px`;
    if (height) element.style.top = `${Math.max(0, Math.min(y || 0, height - bounds.height))}px`;
  }

  function open({kind, id, x, y, keyboard = false, event} = {}) {
    close();
    const value = context();
    const owner = capture(value);
    if (!current(owner) || !['media', 'folder', 'background'].includes(kind)) return false;
    const item = kind === 'media' ? value.snapshot?.media?.find(item => item.id === id) : null;
    const folder = kind === 'folder' ? value.snapshot?.folders?.find(folder => folder.id === id) : null;
    if (kind === 'media' && !item || kind === 'folder' && !folder) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    const focus = focusTarget(event?.target);
    const element = documentRef.createElement('div');
    element.className = 'catalog-context-menu';
    element.dataset.clipboardOwner = 'pool';
    element.setAttribute('role', 'menu');
    element.setAttribute('aria-label', kind === 'background' ? 'Media pool actions' : `${kind === 'folder' ? folder.name : item.name} actions`);
    element.tabIndex = -1;
    const state = {element, owner, focus, buttons: [], submenu: null, submenuButton: null};
    menu = state;

    const activate = action => {
      if (menu !== state) return;
      const valid = current(owner) && owner.writable;
      closeMenu();
      if (valid) dispatch(action);
    };
    const button = (label, action, parent = element, buttons = state.buttons) => {
      const node = documentRef.createElement('button');
      node.type = 'button';
      node.className = 'catalog-menu-item';
      node.textContent = label;
      node.setAttribute('role', 'menuitem');
      node.tabIndex = -1;
      node.disabled = !owner.writable;
      node.addEventListener('click', () => activate(action));
      parent.append(node);
      buttons.push(node);
      return node;
    };
    const beginRename = target_kind => ({kind: 'begin_rename', target_kind, id});

    if (kind === 'media') {
      const existing = new Set(value.snapshot.media.map(item => item.id));
      const media_ids = [...new Set(value.selected || [])].filter(id => existing.has(id));
      if (!media_ids.length) media_ids.push(id);
      if (item.compound_timeline_id) {
        button('Duplicate timeline', {kind: 'duplicate_timeline', id});
        button('Rename', beginRename('media'));
      }
      button(media_ids.length > 1 ? `Relink ${media_ids.length} selected media` : 'Relink media', {kind: 'relink', media_ids});
      button('Add to Library', {kind: 'add_to_library', media_ids});
    } else if (kind === 'folder') {
      button('New folder', {kind: 'new_folder', parent: id});
      button('Rename', beginRename('folder'));
      button('Relink folder', {kind: 'relink_folder', id});
      button('Delete folder', {kind: 'delete_folder', id}).title = 'Keep contents in the parent folder';
    } else {
      button('New folder', {kind: 'new_folder', parent: value.backgroundFolder ?? null});
      const trigger = documentRef.createElement('button');
      trigger.type = 'button';
      trigger.className = 'catalog-menu-item catalog-menu-submenu-trigger';
      trigger.textContent = 'Timelines ▸';
      trigger.setAttribute('role', 'menuitem');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.tabIndex = -1;
      trigger.disabled = !owner.writable;
      element.append(trigger);
      state.buttons.push(trigger);
      const submenu = documentRef.createElement('div');
      submenu.className = 'catalog-menu-submenu';
      submenu.setAttribute('role', 'menu');
      submenu.setAttribute('aria-label', 'Timelines');
      submenu.hidden = true;
      element.append(submenu);
      state.submenu = submenu;
      state.submenuButton = trigger;
      state.submenuButtons = [];
      button('New timeline', {kind: 'new_timeline'}, submenu, state.submenuButtons);
      button('Import OTIO', {kind: 'import_otio'}, submenu, state.submenuButtons);
      trigger.addEventListener('click', () => {
        if (menu !== state || !current(owner) || !owner.writable) return closeMenu();
        showSubmenu(!submenu.hidden);
      });
    }

    function showSubmenu(closeSubmenu = false) {
      state.submenu.hidden = closeSubmenu;
      state.submenuButton.setAttribute('aria-expanded', String(!closeSubmenu));
      if (closeSubmenu) state.submenuButton.focus();
      else {
        const bounds = state.submenuButton.getBoundingClientRect();
        const width = state.submenu.getBoundingClientRect().width;
        const right = bounds.right ?? bounds.left + bounds.width;
        const left = windowRef.innerWidth && right + width > windowRef.innerWidth
          ? bounds.left - width : right;
        position(state.submenu, left, bounds.top);
        state.submenuButtons.find(node => !node.disabled)?.focus();
      }
    }
    element.addEventListener('keydown', key => {
      key.stopPropagation();
      if (key.isComposing || key.keyCode === 229) return;
      if (!current(owner)) { key.preventDefault(); closeMenu(); return; }
      if (key.key === 'Escape') {
        key.preventDefault();
        if (state.submenu && !state.submenu.hidden) showSubmenu(true);
        else closeMenu(true);
        return;
      }
      if (key.key === 'Tab') { closeMenu(); return; }
      const inSubmenu = state.submenu?.contains(key.target);
      const buttons = (inSubmenu ? state.submenuButtons : state.buttons).filter(node => !node.disabled);
      const index = buttons.indexOf(documentRef.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key.key)) {
        key.preventDefault();
        const next = key.key === 'Home' ? 0 : key.key === 'End' ? buttons.length - 1
          : (index + (key.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (key.key === 'ArrowRight' && key.target === state.submenuButton) {
        key.preventDefault(); showSubmenu();
      } else if (key.key === 'ArrowLeft' && inSubmenu) {
        key.preventDefault(); showSubmenu(true);
      } else if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') {
        key.preventDefault();
      } else if (['Enter', ' '].includes(key.key)) {
        key.preventDefault();
        if (!key.repeat && !key.ctrlKey && !key.metaKey && !key.altKey) documentRef.activeElement?.click?.();
      }
    });
    element.addEventListener('contextmenu', event => event.preventDefault());
    documentRef.body.append(element);
    const bounds = focus?.getBoundingClientRect?.() || root.getBoundingClientRect();
    position(element, keyboard ? bounds.left : x, keyboard ? bounds.bottom : y);
    (state.buttons.find(node => !node.disabled) || element).focus();
    return true;
  }

  function rename({kind, id, element, name} = {}) {
    close();
    const value = context();
    const owner = capture(value);
    if (!current(owner) || !owner.writable || !element || element.isConnected === false) return false;
    const item = kind === 'media' ? value.snapshot?.media?.find(item => item.id === id) : null;
    const folder = kind === 'folder' ? value.snapshot?.folders?.find(folder => folder.id === id) : null;
    if (kind === 'media' ? !item?.compound_timeline_id : kind !== 'folder' || !folder) return false;
    const original = String(name ?? (item || folder).name);
    const input = documentRef.createElement('input');
    input.type = 'text';
    input.className = 'catalog-rename-input';
    input.value = original;
    input.maxLength = 128;
    input.setAttribute('aria-label', `Rename ${kind === 'folder' ? 'folder' : 'timeline'}`);
    const overlay = documentRef.createElement('div');
    overlay.className = 'catalog-rename-overlay';
    overlay.dataset.clipboardOwner = 'pool';
    overlay.append(input);
    const bounds = element.getBoundingClientRect();
    overlay.style.position = 'fixed';
    overlay.style.left = `${Math.max(0, bounds.left)}px`;
    overlay.style.top = `${Math.max(0, bounds.top)}px`;
    overlay.style.width = `${Math.max(80, bounds.width)}px`;
    overlay.style.height = `${Math.max(18, bounds.height)}px`;
    const state = {element: overlay, input, owner, target: element, focus: focusTarget(element)};
    editor = state;
    const finish = (accept, returnFocus = false) => {
      if (editor !== state) return;
      const next = input.value.trim();
      const valid = current(owner) && element.isConnected !== false;
      closeEditor();
      if (returnFocus && valid) restore(state.focus);
      if (!accept || !valid || !next || next === original) return;
      if (textBytes(next) > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(next)) {
        notice('Use a name of 1 to 128 UTF-8 bytes without control characters');
        return;
      }
      dispatch({kind: 'rename', target_kind: kind, id, name: next});
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault(); closeEditor(true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) finish(true, true);
      }
    });
    for (const type of ['keyup', 'keypress']) input.addEventListener(type, event => event.stopPropagation());
    input.addEventListener('blur', () => finish(true));
    documentRef.body.append(overlay);
    input.focus();
    input.select();
    return true;
  }

  const outside = event => {
    if (menu && !menu.element.contains(event.target)) closeMenu();
  };
  const moved = event => {
    if (menu?.element.contains(event.target)) return;
    close();
  };
  const blurred = () => close();
  const visibility = () => { if (documentRef.hidden) close(); };
  const dialog = event => { if (event.target?.matches?.('dialog') && event.target.open) close(); };
  const listeners = [
    [documentRef, 'pointerdown', outside, true],
    [documentRef, 'focusin', outside, true],
    [documentRef, 'scroll', moved, true],
    [documentRef, 'visibilitychange', visibility, true],
    [documentRef, 'toggle', dialog, true],
    [windowRef, 'blur', blurred, false],
    [windowRef, 'resize', blurred, false],
  ];
  for (const [target, type, callback, options] of listeners) target.addEventListener(type, callback, options);
  return {
    open, rename, close,
    dispose() {
      close();
      disposed = true;
      for (const [target, type, callback, options] of listeners) target.removeEventListener(type, callback, options);
    },
  };
}
