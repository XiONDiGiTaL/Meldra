import { t } from './i18n.js';
import type { I18nKey } from './i18n.js';

interface Props {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      if (handler) node.addEventListener(event, handler);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function keycap(label: string): HTMLElement {
  return el('kbd', { text: label });
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast ${kind === 'info' ? '' : kind}`, text: message });
  host.append(node);
  while (host.children.length > 3) host.removeChild(host.firstElementChild as Element);
  const current = node;
  setTimeout(() => current.remove(), 3200);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
  }, 300);
}

export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = el('textarea', { attrs: { 'aria-hidden': 'true' } });
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export interface ModalOptions {
  title: string;
  body: HTMLElement;
  actions?: HTMLElement[];
  onClose?: () => void;
  closeLabel?: string;
}

export function openModal(options: ModalOptions): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const closeBtn = el('button', {
    class: 'icon-btn',
    attrs: { type: 'button', 'aria-label': t('common.close') },
    text: '✕',
    on: { click: () => close() },
  });
  const head = el(
    'div',
    { class: 'modal-head' },
    el('div', {}, el('h2', { text: options.title })),
    closeBtn,
  );
  const actions = el('div', { class: 'btn-row', attrs: { style: 'margin-top:16px' } });
  for (const action of options.actions ?? []) actions.append(action);
  const card = el('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true' } }, head, options.body, actions);
  const backdrop = el('div', { class: 'modal-backdrop' }, card);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    options.onClose?.();
    previouslyFocused?.focus?.();
  };

  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  const focusTarget = card.querySelector<HTMLElement>('button,[href],input,select,textarea');
  focusTarget?.focus();
  return close;
}

export interface GuideEntry {
  keys: string[];
  labelKey: I18nKey;
  detailKey?: I18nKey;
}

export function guideEntries(mode: 'keyboard' | 'touch'): GuideEntry[] {
  if (mode === 'touch') {
    return [
      { keys: ['↔'], labelKey: 'controls.touchMove', detailKey: 'controls.drag' },
      { keys: ['↻'], labelKey: 'controls.touchRotate', detailKey: 'controls.repeat' },
      { keys: ['↓'], labelKey: 'controls.touchSoft' },
      { keys: ['⤓'], labelKey: 'controls.touchHard' },
      { keys: ['◎'], labelKey: 'controls.touchPing' },
    ];
  }
  return [
    { keys: t('controls.moveKeys').split(' / '), labelKey: 'controls.move' },
    { keys: [t('controls.rotateKeys')], labelKey: 'controls.rotate' },
    { keys: [t('controls.rotateBackKeys')], labelKey: 'controls.rotateBack' },
    { keys: [t('controls.softKeys')], labelKey: 'controls.soft' },
    { keys: [t('controls.hardKeys')], labelKey: 'controls.hard' },
    { keys: [t('controls.pingKeys')], labelKey: 'controls.ping' },
    { keys: [t('controls.pauseKeys')], labelKey: 'controls.pause' },
  ];
}

export function controlGuide(mode: 'keyboard' | 'touch', filter?: GuideEntry['labelKey'][]): HTMLElement {
  const entries = guideEntries(mode).filter((entry) => !filter || filter.includes(entry.labelKey));
  const grid = el('div', { class: 'guide' });
  for (const entry of entries) {
    const keys = el('div', { class: 'keys' });
    for (const key of entry.keys) keys.append(keycap(key));
    grid.append(
      el(
        'div',
        { class: 'guide-item' },
        keys,
        el(
          'div',
          { class: 'guide-body' },
          el('b', { text: t(entry.labelKey) }),
          entry.detailKey ? el('span', { text: t(entry.detailKey) }) : null,
        ),
      ),
    );
  }
  return grid;
}

export function pill(text: string, kind?: 'ready' | 'host' | 'offline'): HTMLElement {
  return el('span', { class: `pill ${kind ?? ''}`.trim(), text });
}

export function progressBar(value: number, max: number): HTMLElement {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const inner = el('i');
  inner.style.width = `${Math.round(ratio * 100)}%`;
  return el('div', { class: 'progress', attrs: { role: 'progressbar' } }, inner);
}

export function menuButton(label: string, onClick: () => void, kind = ''): HTMLButtonElement {
  return el('button', {
    class: `btn ${kind}`.trim(),
    attrs: { type: 'button' },
    text: label,
    on: { click: onClick },
  });
}
