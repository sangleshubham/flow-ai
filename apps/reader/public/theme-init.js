// Runs before first paint to avoid a light flash in dark mode. A static file (not an inline script)
// so the app CSP needs no 'unsafe-inline' in script-src (spec §17, ADR 0001, W11).
;(function () {
  var mql = window.matchMedia('(prefers-color-scheme: dark)')
  var scheme = localStorage.getItem('literal-color-scheme') || 'system'
  if (scheme === '"dark"' || (scheme === '"system"' && mql.matches)) {
    document.documentElement.classList.toggle('dark', true)
    var meta = document.querySelector('#theme-color')
    if (meta) meta.setAttribute('content', '#24292e')
  }
})()
