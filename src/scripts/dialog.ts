// Popup card: progressive enhancement over plain /r/<slug>/ links.
const dlg = document.getElementById('card-dialog') as HTMLDialogElement | null;
const inner = dlg?.querySelector<HTMLElement>('.dialog-inner');
const listUrl = document.body.dataset.listUrl || '/';
const baseTitle = document.body.dataset.listTitle || document.title;
const siteTitle = document.body.dataset.siteTitle || document.title;
let savedY = 0;
let locked = false;

function lock() {
  if (locked) return;
  locked = true;
  savedY = window.scrollY;
  // Keep the page (and its scrollbar) exactly where it is while the card is open.
  Object.assign(document.body.style, { position: 'fixed', top: `-${savedY}px`, left: '0', right: '0' });
}
function unlock() {
  if (!locked) return;
  locked = false;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' });
  window.scrollTo(0, savedY);
}

function render(slug: string): boolean {
  const tpl = document.querySelector<HTMLTemplateElement>(`template[data-card="${CSS.escape(slug)}"]`);
  if (!tpl || !inner) return false;
  inner.replaceChildren(tpl.content.cloneNode(true));
  document.title = `${tpl.dataset.title} · ${siteTitle}`;
  return true;
}

function show() {
  if (!dlg) return;
  if (dlg.open && !dlg.matches(':modal')) dlg.close();
  if (!dlg.open) dlg.showModal();
  lock();
  inner?.scrollTo(0, 0);
  dlg.scrollTo(0, 0);
}

function hide() {
  if (dlg?.open) dlg.close();
  unlock();
  document.title = baseTitle;
}

function open(slug: string) {
  if (!render(slug)) {
    location.href = `/r/${slug}/`;
    return;
  }
  show();
  history.pushState({ card: slug, inPage: true }, '', `/r/${slug}/`);
}

function close() {
  const st = history.state as { card?: string; inPage?: boolean } | null;
  if (st?.inPage) {
    history.back(); // popstate hides the dialog
  } else {
    history.replaceState(null, '', listUrl);
    hide();
  }
}

if (dlg && inner) {
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const item = t.closest<HTMLAnchorElement>('a.item');
    if (item && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey && !(e as MouseEvent).shiftKey && (e as MouseEvent).button === 0) {
      const slug = item.dataset.slug!;
      if (document.querySelector(`template[data-card="${CSS.escape(slug)}"]`)) {
        e.preventDefault();
        open(slug);
      }
      return;
    }
    if (t.closest('#card-dialog a.close')) {
      e.preventDefault();
      close();
      return;
    }
    if (t === dlg) close(); // backdrop
  });
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  window.addEventListener('popstate', (e) => {
    const st = e.state as { card?: string } | null;
    if (st?.card && render(st.card)) show();
    else hide();
  });

  // Landed directly on /r/<slug>/: upgrade the server-rendered open dialog to a modal.
  const initial = dlg.dataset.initial;
  if (initial) {
    history.replaceState({ card: initial, inPage: false }, '', location.href);
    render(initial);
    show();
  }
}
