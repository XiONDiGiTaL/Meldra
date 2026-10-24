import type { AppApi } from '../api.js';
import { t } from '../i18n.js';
import { nextPaletteId, paletteById } from '../palettes.js';
import { drawPalettePreview } from '../render.js';
import { el, toast } from '../ui.js';
import { isRoomCode, normalizeRoomCode } from '../../shared/protocol.js';
import { isOnlineMode } from '../../shared/types.js';
import type { GameMode } from '../../shared/types.js';
import { sfx } from '../audio.js';

interface ModeSpec {
  mode: GameMode;
  icon: string;
  title: string;
  desc: string;
  tone?: 'mint' | 'rose' | 'violet';
}

export function renderHome(api: AppApi): { node: HTMLElement; dispose: () => void } {
  const settings = api.settings;
  let paletteId = settings.palette;

  const preview = el('canvas');
  const swatches = el('div', { class: 'palette-swatches' });
  const paletteName = el('div', { class: 'palette-name' });
  const draw = (): void => {
    drawPalettePreview(preview, paletteId, 'bloom');
  };

  const paintPaletteMeta = (): void => {
    const palette = paletteById(paletteId);
    paletteName.textContent = t(palette.nameKey);
    swatches.replaceChildren(...palette.colors.map((color) => el('i', { attrs: { style: `background:${color}` } })));
  };

  function changePalette(id: string): void {
    paletteId = id;
    api.setPalette(id);
    paintPaletteMeta();
    draw();
    toast(t('toast.paletteChanged', { name: t(paletteById(id).nameKey) }), 'good');
  }

  const prev = el('button', {
    class: 'btn',
    attrs: { type: 'button', 'aria-label': t('home.prevPalette') },
    text: '‹',
    on: {
      click: () => {
        changePalette(nextPaletteId(paletteId, -1));
        sfx.ui();
      },
    },
  });
  const next = el('button', {
    class: 'btn',
    attrs: { type: 'button', 'aria-label': t('home.nextPalette') },
    text: '›',
    on: {
      click: () => {
        changePalette(nextPaletteId(paletteId, 1));
        sfx.ui();
      },
    },
  });

  const nameInput = el('input', {
    class: 'input',
    attrs: {
      type: 'text',
      maxlength: '18',
      placeholder: t('home.namePlaceholder'),
      'aria-label': t('home.nameLabel'),
      autocomplete: 'nickname',
      value: settings.name,
    },
    on: {
      input: (event) => api.setName((event.target as HTMLInputElement).value),
    },
  });

  const codeInput = el('input', {
    class: 'input code',
    attrs: {
      type: 'text',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: '5',
      placeholder: t('home.joinPlaceholder'),
      'aria-label': t('home.joinLabel'),
    },
    on: {
      input: (event) => {
        const input = event.target as HTMLInputElement;
        input.value = normalizeRoomCode(input.value).slice(0, 5);
      },
    },
  });

  const submitJoin = (): void => {
    const code = normalizeRoomCode(codeInput.value);
    if (!isRoomCode(code)) {
      toast(t('errors.invalidCode'), 'warn');
      codeInput.focus();
      return;
    }
    api.joinRoom(code);
  };

  const joinButton = el('button', {
    class: 'btn primary',
    attrs: { type: 'button' },
    text: t('home.joinButton'),
    on: { click: submitJoin },
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && document.activeElement === codeInput) {
      event.preventDefault();
      submitJoin();
    }
  };

  function modeCard(spec: ModeSpec): HTMLButtonElement {
    return el(
      'button',
      {
        class: `mode-card ${spec.tone ?? ''}`.trim(),
        attrs: {
          type: 'button',
          'data-mode': spec.mode,
          'aria-label': `${spec.title} — ${spec.desc}`,
        },
        on: {
          click: () => {
            sfx.unlock();
            if (isOnlineMode(spec.mode)) api.playTogether(spec.mode);
            else api.practice(spec.mode);
          },
        },
      },
      el('span', { class: 'mode-icon', text: spec.icon }),
      el(
        'span',
        { class: 'mode-copy' },
        el('b', { text: spec.title }),
        el('small', { text: spec.desc }),
      ),
      el('span', { class: 'mode-arrow', text: '→' }),
    );
  }

  const primaryModes: ModeSpec[] = [
    { mode: 'solo', icon: '◍', title: t('home.soloTitle'), desc: t('home.soloDesc') },
    {
      mode: 'coop',
      icon: '◐',
      title: t('home.togetherTitle'),
      desc: t('home.togetherDesc'),
      tone: 'mint',
    },
    {
      mode: 'versus',
      icon: '⚔',
      title: t('home.versusTitle'),
      desc: t('home.versusDesc'),
      tone: 'rose',
    },
    { mode: 'endless', icon: '∞', title: t('home.endlessTitle'), desc: t('home.endlessDesc') },
  ];

  const extraModes: ModeSpec[] = [
    {
      mode: 'relay',
      icon: '⇄',
      title: t('home.relayTitle'),
      desc: t('home.relayDesc'),
      tone: 'violet',
    },
    { mode: 'rift', icon: '◈', title: t('home.riftTitle'), desc: t('home.riftDesc'), tone: 'violet' },
    {
      mode: 'architect',
      icon: '▤',
      title: t('home.architectTitle'),
      desc: t('home.architectDesc'),
    },
  ];

  const head = el(
    'div',
    { class: 'home-head' },
    el('span', { class: 'eyebrow', text: t('home.eyebrow') }),
    el('h1', { class: 'grad', text: t('app.tagline') }),
    el('p', { class: 'home-sub', text: t('home.sub') }),
  );

  const modeGrid = el(
    'div',
    { class: 'mode-section' },
    el('div', { class: 'section-line' }, el('span', { text: t('home.pickMode') }), el('i')),
    el('div', { class: 'mode-grid' }, ...primaryModes.map(modeCard)),
  );

  const more = el(
    'details',
    { class: 'more-modes' },
    el('summary', {}, el('span', { text: t('home.moreTitle') }), el('i', { text: '+' })),
    el('div', { class: 'mode-grid compact' }, ...extraModes.map(modeCard)),
  );

  const joinPanel = el(
    'div',
    { class: 'join-panel' },
    el(
      'div',
      { class: 'join-copy' },
      el('div', { class: 'field-label', text: t('home.joinLabel') }),
      el('p', { class: 'tiny faint', text: t('home.joinHint') }),
    ),
    el('div', { class: 'join-row' }, codeInput, joinButton),
  );

  const helpButton = el('button', {
    class: 'chip-btn',
    attrs: { type: 'button' },
    text: t('home.quickHelp'),
    on: { click: () => api.openHelp() },
  });

  const identity = el(
    'aside',
    { class: 'panel panel-pad identity' },
    el('div', { class: 'panel-title' }, el('span', { class: 'label', text: t('home.identity') })),
    el('div', { class: 'field' }, el('label', { text: t('home.nameLabel') }), nameInput),
    el(
      'div',
      { class: 'field' },
      el('div', { class: 'palette-head' }, el('span', { class: 'field-label', text: t('home.paletteLabel') })),
      el('div', { class: 'cycler' }, prev, paletteName, next),
      swatches,
    ),
    el('div', { class: 'preview-wrap small' }, preview),
    el(
      'div',
      { class: 'legend' },
      el('span', { class: 'item' }, el('i', { class: 'owner-sample you' }), el('span', { text: t('home.legendYou') })),
      el(
        'span',
        { class: 'item' },
        el('i', { class: 'owner-sample partner' }),
        el('span', { text: t('home.legendPartner') }),
      ),
    ),
    el('p', { class: 'tiny faint', text: t('home.footer') }),
  );

  const node = el(
    'div',
    { class: 'home' },
    el(
      'main',
      { class: 'home-card panel' },
      head,
      modeGrid,
      more,
      joinPanel,
      el('div', { class: 'home-foot' }, helpButton),
    ),
    identity,
  );

  paintPaletteMeta();
  requestAnimationFrame(draw);
  document.addEventListener('keydown', onKey);

  const onResize = (): void => draw();
  window.addEventListener('resize', onResize);

  return {
    node,
    dispose: () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}
