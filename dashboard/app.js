// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, and a detail view for
// every protocol with the model's own arithmetic and its farm plan. No network:
// every byte it shows is in data.js. Deep links live in the hash, so a view can
// be opened directly: #slug=<slug> opens a detail, #category=Dexs,
// #chain=Base, #watchlist=1 and #tab=live filter the board.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var boardEl = document.getElementById('board');
  if (!DATA || !boardEl) return;
  boardEl.setAttribute('aria-busy', 'false');

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre', sort: 'implied', dir: -1, shown: 50, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- header numbers -------------------------------------------------------
  var top = DATA.board[0];
  var totalImplied = DATA.board.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  document.getElementById('stats').innerHTML =
    '<div><dt>Protocols ranked</dt><dd>' + DATA.board.length + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + DATA.model.watchlist_rows + ' <small>of ' + DATA.board.filter(function (r) { return r.watchlist; }).length + ' on the list</small></dd></div>' +
    '<div><dt>Top implied value</dt><dd>' + fmtUsd(top ? top.implied_value_usd : 0) + ' <small>' + esc(top ? top.name : '') + '</small></dd></div>' +
    '<div><dt>Board total</dt><dd>' + fmtUsd(totalImplied) + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>';
  document.getElementById('src').textContent = DATA.source;
  document.getElementById('floor').textContent = fmtUsd(DATA.floor_usd);

  // ---- filter options --------------------------------------------------------
  function fillSelect(id, values) {
    var el = document.getElementById(id);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }
  fillSelect('category', Array.from(new Set(DATA.board.map(function (r) { return r.category || 'Uncategorised'; }))).sort());
  fillSelect('chain', Array.from(new Set(DATA.board.flatMap(function (r) { return r.chains; }))).sort());

  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var moreBtn = document.getElementById('more');
  var detailEl = document.getElementById('detail');

  function visibleRows() {
    var pool = state.tab === 'live' ? DATA.live : DATA.board;
    var q = state.q.trim().toLowerCase();
    var rows = pool.filter(function (r) {
      if (state.tab === 'pre') {
        if (state.watchlist && !r.watchlist) return false;
        if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
        if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
        if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false;
      } else if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) {
        return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd || 0; bv = b.implied_value_usd || 0; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { return dir * (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
      else if (key === 'category') { return dir * ((a.category || '') < (b.category || '') ? -1 : 1); }
      else if (key === 'rank') { av = a.rank || 0; bv = b.rank || 0; }
      else { av = a.implied_value_usd || 0; bv = b.implied_value_usd || 0; }
      return dir * (av - bv);
    });
    return rows;
  }

  function rowHtml(r, i) {
    var growth = r.change_7d === null ? '<span>n/a</span>' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
    var value = state.tab === 'live'
      ? '<td class="num">' + fmtUsd(r.mcap_usd) + '<br><span class="pill">mcap/TVL ' + r.ratio.toFixed(2) + '</span></td>'
      : '<td class="num"><strong>' + fmtUsd(r.implied_value_usd) + '</strong></td>';
    var rankCell = state.tab === 'live' ? '<td class="num">' + (i + 1) + '</td>' : '<td class="num">' + r.rank + '</td>';
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'selected' : '') + '">' +
      rankCell +
      '<td class="name"><strong>' + esc(r.name) + (r.watchlist ? ' <span class="star" title="On the watchlist">★</span>' : '') + '</strong><span>' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + growth + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      value +
      '<td>' + (state.tab === 'live' ? '<span class="pill">trading</span>' : '<button type="button" class="plan" data-plan="' + esc(r.slug) + '">Farm plan →</button>') + '</td>' +
      '</tr>';
  }

  function render() {
    var rows = visibleRows();
    var shown = rows.slice(0, state.shown);
    rowsEl.innerHTML = shown.map(function (r, i) { return rowHtml(r, i); }).join('') ||
      '<tr><td colspan="9">Nothing matches these filters. Loosen the search or clear a filter.</td></tr>';
    countEl.textContent = 'Showing ' + shown.length + ' of ' + rows.length + ' protocol' + (rows.length === 1 ? '' : 's') +
      (state.tab === 'pre' ? ' · ★ marks the watchlist · values are implied, not promised' : ' · tokens already trading — the comparables the board is priced against');
    moreBtn.parentElement.style.display = rows.length > state.shown ? '' : 'none';
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    document.querySelectorAll('#table th[data-sort]').forEach(function (th) {
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.getAttribute('data-sort') === state.sort ? (state.dir === -1 ? ' ▼' : ' ▲') : '');
    });
  }

  // ---- detail view ------------------------------------------------------------
  function openDetail(slug) {
    var r = DATA.board.find(function (x) { return x.slug === slug; });
    if (!r) return;
    state.selected = slug;
    var b = r.breakdown;
    // Recompute the value from its factors on the page, so the code and the board agree.
    var recomputed = Math.round(r.tvl_usd * b.ratio * b.growth * b.maturity * b.breadth * b.prior);
    var chainSummary = r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) + ' more' : '');
    detailEl.innerHTML =
      '<button type="button" class="close" id="close-detail">Close ×</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? ' <span class="star" title="On the watchlist">★ watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(chainSummary) + ' · TVL ' + fmtUsd(r.tvl_usd) +
      ' · 7-day change ' + fmtPct(r.change_7d) + ' · tracked since ' + esc(r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ' with no token recorded)</p>' +
      '<h3>How the value is built</h3>' +
      '<table class="math"><tbody>' +
      '<tr><td>TVL</td><td>' + fmtUsd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category ratio — ' + esc(b.ratioSource) + '</td><td>× ' + b.ratio.toFixed(3) + ' = ' + fmtUsd(b.base) + '</td></tr>' +
      '<tr><td>Growth tilt (7-day TVL change ' + fmtPct(r.change_7d) + ')</td><td>× ' + b.growth.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity tilt (' + fmtAge(r.age_days) + ' with no token recorded)</td><td>× ' + b.maturity.toFixed(3) + '</td></tr>' +
      '<tr><td>Breadth tilt (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>× ' + b.breadth.toFixed(3) + '</td></tr>' +
      '<tr><td>Category prior (how often this category issues a token)</td><td>× ' + b.prior.toFixed(3) + '</td></tr>' +
      '<tr class="total"><td>Implied value (page recomputes ' + fmtUsd(recomputed) + ')</td><td>' + fmtUsd(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="sub">The implied value is this entry\u2019s own claim. It is not a prediction that a token will be issued, or what it would trade at if one were.</p>' +
      '<h3>Farm plan — what to do about it</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    document.getElementById('close-detail').addEventListener('click', closeDetail);
    render();
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeDetail() {
    state.selected = null;
    detailEl.hidden = true;
    detailEl.innerHTML = '';
    if (location.hash.indexOf('slug=') !== -1) history.replaceState(null, '', location.pathname);
    render();
  }

  // ---- events -------------------------------------------------------------------
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; state.shown = 50; render(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; state.shown = 50; render(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; state.shown = 50; render(); });
  document.getElementById('watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; state.shown = 50; render(); });
  document.getElementById('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' || state.sort === 'category' ? 1 : -1;
    render();
  });
  document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre'; state.shown = 50; render(); });
  document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; state.shown = 50; render(); });
  moreBtn.addEventListener('click', function () { state.shown += 50; render(); });
  document.querySelectorAll('#table th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      if (['implied', 'tvl', 'growth', 'age', 'name'].indexOf(key) !== -1) {
        document.getElementById('sort').value = key;
      }
      render();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var plan = e.target.closest('[data-plan]');
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    if (state.tab === 'live') return;
    openDetail(plan ? plan.getAttribute('data-plan') : tr.getAttribute('data-slug'));
  });

  // ---- deep links --------------------------------------------------------------
  var hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('tab') === 'live') state.tab = 'live';
  if (hash.get('category')) { state.category = hash.get('category'); document.getElementById('category').value = state.category; }
  if (hash.get('chain')) { state.chain = hash.get('chain'); document.getElementById('chain').value = state.chain; }
  if (hash.get('watchlist') === '1') { state.watchlist = true; document.getElementById('watchlist').checked = true; }
  if (hash.get('q')) { state.q = hash.get('q'); document.getElementById('q').value = state.q; }
  render();
  if (hash.get('slug')) openDetail(hash.get('slug'));
})();
