const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#main-navigation');
const siteHeader = document.querySelector('.site-header');
let headerFramePending = false;
function updateHeader() {
  siteHeader?.classList.toggle('is-condensed', window.scrollY > 64);
  headerFramePending = false;
}
window.addEventListener('scroll', () => {
  if (!headerFramePending) {
    headerFramePending = true;
    requestAnimationFrame(updateHeader);
  }
}, {passive: true});
window.addEventListener('pageshow', updateHeader);
updateHeader();

// Show the lightweight still immediately. Use the original 4K PNG when motion
// is unavailable, disallowed by device preferences, or buffering for too long.
document.querySelectorAll('.world-hero').forEach(hero => {
  const video = hero.querySelector('.hero-video');
  const picture = hero.querySelector('.hero-art');
  const still = picture?.querySelector('img');
  if (!video || !still) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const bounds = hero.getBoundingClientRect();
  let visible = bounds.bottom > 0 && bounds.top < innerHeight;
  let failed = false;
  let fallbackRequested = false;
  let deadline;
  video.muted = true;
  const preferencesAllowMotion = () => !reduced.matches && !connection?.saveData &&
    !['slow-2g', '2g'].includes(connection?.effectiveType);
  const shouldPlay = () => preferencesAllowMotion() && visible && !document.hidden && !failed;
  const clearDeadline = () => { clearTimeout(deadline); deadline = undefined; };
  const showStill = () => {
    clearDeadline();
    video.classList.remove('is-ready');
    video.pause();
    if (!fallbackRequested && picture.dataset.fallback) {
      fallbackRequested = true;
      const png = new Image();
      png.onload = () => {
        // Keep the already-painted WebP until the full-resolution PNG is ready.
        picture.querySelectorAll('source').forEach(source => source.remove());
        still.src = picture.dataset.fallback;
      };
      png.src = picture.dataset.fallback;
    }
  };
  const fallback = () => {
    failed = true;
    showStill();
    // Stop spending bandwidth on a failed or slow background video.
    if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
  };
  const startDeadline = () => {
    if (deadline === undefined && shouldPlay()) deadline = setTimeout(fallback, 5000);
  };
  const sync = () => {
    if (failed || !preferencesAllowMotion()) { showStill(); return; }
    if (!visible || document.hidden) { clearDeadline(); video.pause(); return; }
    if (!video.canPlayType('video/mp4')) { fallback(); return; }
    if (!video.getAttribute('src')) { video.src = video.dataset.src; startDeadline(); }
    else if (video.paused || video.readyState < 3) startDeadline();
    video.play()?.catch(error => {
      // Visibility changes can legitimately interrupt a pending play request.
      if (error.name === 'AbortError' || !shouldPlay()) return;
      fallback();
    });
  };
  video.addEventListener('playing', () => {
    clearDeadline();
    if (shouldPlay()) video.classList.add('is-ready');
    else video.pause();
  });
  video.addEventListener('error', fallback);
  video.addEventListener('waiting', startDeadline);
  video.addEventListener('stalled', startDeadline);
  reduced.addEventListener('change', sync);
  connection?.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { clearDeadline(); video.pause(); });
  window.addEventListener('pageshow', sync);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      sync();
    }).observe(hero);
  }
  sync();
});

function closeMenu() { menu?.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open'); }
menu?.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('menu-open', open); });
navigation?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { closeMenu(); menu.focus(); } });
matchMedia('(min-width: 1101px)').addEventListener('change', e => { if (e.matches) closeMenu(); });

document.querySelectorAll('.filter-bar').forEach(bar => {
  const grid = bar.nextElementSibling;
  bar.addEventListener('click', e => {
    const button = e.target.closest('button[data-filter]'); if (!button) return;
    bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    const items = [...grid.querySelectorAll('[data-category]')];
    grid.dataset.activeFilter = button.dataset.filter;
    items.forEach(item => { item.hidden = button.dataset.filter !== 'all' && !item.dataset.category.split(' ').includes(button.dataset.filter); });
    const status = grid.nextElementSibling;
    if (status?.classList.contains('filter-status')) status.textContent = `${items.filter(item => !item.hidden).length} images · ${button.textContent}`;
  });
});

// Compact, manual image viewers. All images remain in a grid without JavaScript.
document.querySelectorAll('.case-content .gallery, .florida-showcase').forEach((group, groupIndex) => {
  const slides = [...group.children].filter(child => child.tagName === 'FIGURE');
  if (slides.length < 2) return;
  group.classList.add('is-carousel');
  group.setAttribute('role', 'region');
  group.setAttribute('aria-roledescription', 'carousel');
  if (!group.hasAttribute('aria-label')) group.setAttribute('aria-label', `Project image gallery ${groupIndex + 1}`);
  let selected = 0;
  const controls = document.createElement('div');
  controls.className = 'carousel-controls';
  const previous = document.createElement('button');
  previous.type = 'button'; previous.textContent = '← Previous';
  const next = document.createElement('button');
  next.type = 'button'; next.textContent = 'Next →';
  const status = document.createElement('span');
  status.className = 'carousel-status';
  status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  controls.append(previous, status, next);
  const thumbnails = document.createElement('div');
  thumbnails.className = 'carousel-thumbnails';
  thumbnails.setAttribute('role', 'group'); thumbnails.setAttribute('aria-label', 'Choose an image');
  const buttons = slides.map((slide, index) => {
    if (!slide.id) slide.id = `gallery-${groupIndex + 1}-image-${index + 1}`;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} of ${slides.length}`);
    const original = slide.querySelector('img');
    const button = document.createElement('button');
    button.type = 'button'; button.setAttribute('aria-controls', slide.id);
    button.setAttribute('aria-label', `Show ${original?.alt || `image ${index + 1}`}`);
    if (original) {
      const thumb = document.createElement('img');
      thumb.src = original.dataset.thumb || original.src; thumb.alt = ''; thumb.loading = 'lazy';
      button.append(thumb);
    }
    button.addEventListener('click', () => select(index));
    thumbnails.append(button);
    return button;
  });
  function select(index, eager = true) {
    selected = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, i) => { slide.hidden = i !== selected; buttons[i].setAttribute('aria-pressed', String(i === selected)); });
    const activeImage = slides[selected].querySelector('img');
    if (activeImage && eager) activeImage.loading = 'eager';
    status.textContent = `${selected + 1} / ${slides.length} · Select image to enlarge`;
    previous.disabled = selected === 0; next.disabled = selected === slides.length - 1;
    if (eager) {
      const rail = thumbnails.getBoundingClientRect();
      const thumb = buttons[selected].getBoundingClientRect();
      if (matchMedia('(min-width: 761px)').matches) {
        if (thumb.top < rail.top) thumbnails.scrollTop -= rail.top - thumb.top;
        if (thumb.bottom > rail.bottom) thumbnails.scrollTop += thumb.bottom - rail.bottom;
      } else {
        if (thumb.left < rail.left) thumbnails.scrollLeft -= rail.left - thumb.left;
        if (thumb.right > rail.right) thumbnails.scrollLeft += thumb.right - rail.right;
      }
    }
  }
  previous.addEventListener('click', () => select(selected - 1));
  next.addEventListener('click', () => select(selected + 1));
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : selected + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
    select(nextIndex); buttons[selected].focus();
  });
  let touchStart;
  group.addEventListener('touchstart', event => {
    if (event.target.closest('.carousel-thumbnails, .carousel-controls')) return;
    const touch = event.touches[0]; touchStart = {x:touch.clientX, y:touch.clientY};
  }, {passive:true});
  group.addEventListener('touchend', event => {
    if (!touchStart) return;
    const touch = event.changedTouches[0], dx = touch.clientX - touchStart.x, dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) select(selected + (dx < 0 ? 1 : -1));
    touchStart = null;
  }, {passive:true});
  group.append(controls, thumbnails);
  const revealHash = () => {
    const index = slides.findIndex(slide => `#${slide.id}` === location.hash);
    if (index >= 0) select(index);
  };
  select(0, false); revealHash(); window.addEventListener('hashchange', revealHash);
});

const dialog = document.querySelector('.lightbox');
const image = dialog?.querySelector('.lightbox-image');
let gallery = [], current = 0, returnFocus;
function showImage(index) {
  current = (index + gallery.length) % gallery.length;
  const link = gallery[current];
  const title = link.dataset.title || link.querySelector('img')?.alt || '';
  image.src = link.href; image.alt = title;
  dialog.querySelector('#lightbox-caption').textContent = title;
  dialog.querySelector('.lightbox-count').textContent = `${current + 1} / ${gallery.length}`;
  dialog.querySelector('.lightbox-original').href = link.href;
  dialog.querySelector('.lightbox-prev').disabled = gallery.length < 2;
  dialog.querySelector('.lightbox-next').disabled = gallery.length < 2;
}
document.querySelectorAll('a[data-lightbox]').forEach(link => link.addEventListener('click', e => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !dialog) return;
  e.preventDefault(); returnFocus = link;
  const group = link.closest('.gallery, .art-grid');
  const candidates = [...(group || document).querySelectorAll('a[data-lightbox]')];
  gallery = group?.classList.contains('is-carousel') ? candidates : candidates.filter(a => !a.closest('[hidden]'));
  showImage(gallery.indexOf(link)); dialog.showModal(); document.body.classList.add('lightbox-open');
  dialog.querySelector('.lightbox-close').focus();
}));
dialog?.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
dialog?.querySelector('.lightbox-prev').addEventListener('click', () => showImage(current - 1));
dialog?.querySelector('.lightbox-next').addEventListener('click', () => showImage(current + 1));
dialog?.addEventListener('keydown', e => { if(e.key === 'ArrowLeft') { e.preventDefault(); showImage(current - 1); } if(e.key === 'ArrowRight') { e.preventDefault(); showImage(current + 1); } });
dialog?.addEventListener('click', e => { if(e.target === dialog) { const r=dialog.getBoundingClientRect(); if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close(); } });
dialog?.addEventListener('close', () => { document.body.classList.remove('lightbox-open'); image.removeAttribute('src'); returnFocus?.focus(); });

// Respect native image sizes even for legacy assets with inconsistent width attributes.
document.querySelectorAll('img:not(.hero-art img)').forEach(img => {
  const cap = () => { if (img.naturalWidth) img.style.setProperty('--native-width', `${img.naturalWidth}px`); };
  img.complete ? cap() : img.addEventListener('load', cap, {once:true});
});
