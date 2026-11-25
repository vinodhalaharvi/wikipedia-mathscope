/* MathScope service worker. Its only job: when the toolbar button is clicked,
   run MathScope on the current tab. That is how it works on sites outside the
   built-in list, without asking for access to every website. */
async function runOnTab(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page-mathjax.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}
self.runOnTab = runOnTab;
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id !== undefined) runOnTab(tab.id).catch(() => { /* pages such as chrome:// cannot be scripted */ });
});
