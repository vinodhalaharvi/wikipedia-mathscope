/* MathScope helper that runs in the page's own JavaScript world.
   MathJax 3 and 4 keep each formula's TeX source in memory, not in the DOM, so
   the content script cannot see it. This script asks MathJax for the sources and
   writes each one onto its <mjx-container> as a data attribute. It changes
   nothing else and sends nothing anywhere. */
(() => {
  if (window.__mathscopeMathJax) return;
  window.__mathscopeMathJax = true;
  function tag() {
    let added = 0;
    try {
      const MJ = window.MathJax, doc = MJ && MJ.startup && MJ.startup.document;
      if (!doc || !doc.math) return 0;
      const list = typeof doc.math.toArray === 'function' ? doc.math.toArray() : Array.from(doc.math);
      for (const item of list) {
        const el = item && item.typesetRoot;
        if (!el || typeof el.setAttribute !== 'function' || typeof item.math !== 'string') continue;
        if (item.inputJax && item.inputJax.name && item.inputJax.name !== 'TeX') continue;
        if (el.getAttribute('data-mathscope-tex') === item.math) continue;
        el.setAttribute('data-mathscope-tex', item.math);
        if (item.display) el.setAttribute('data-mathscope-display', '1');
        added++;
      }
    } catch (err) { /* a page with an unusual MathJax build: leave it alone */ }
    if (added) document.dispatchEvent(new CustomEvent('mathscope-mathjax'));
    return added;
  }
  document.addEventListener('mathscope-rescan', tag);
  tag();
  [600, 2000, 5000].forEach((ms) => setTimeout(tag, ms));
  try {
    const p = window.MathJax && window.MathJax.startup && window.MathJax.startup.promise;
    if (p && typeof p.then === 'function') p.then(tag);
  } catch (err) { /* ignore */ }
})();
