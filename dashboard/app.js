// Token Launch Radar — the page. Reads window.RADAR (data.js, written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, a per-protocol detail drawer with the full
// valuation arithmetic and farm plan, the category multiple table and the live-token strip.
// No network, no framework: every byte it shows arrived in data.js.
//
// The view state also reads the query string — ?cat=, ?chain=, ?band=, ?q=, ?watch=1,
// ?sort=, ?open=<slug> — so a filtered board or an open detail can be linked (and screenshotted)
// exactly as a reader would see it after clicking.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var params = new URLSearchParams(window.location.search);

  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    band: params.get('band') || 'all',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    open: params.get('open') || null,
  };

  /* ---------- formatting ---------- */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.4) + 'mo';
    return days + 'd';
  }
  function fmtMult(n) {
    return (Math.round(n * 100) / 100).toFixed(2) + '×';
  }
  function fmtFactor(n) {
    return '×' + (Math.round(n * 1000) / 1000).toFixed(3);
  }

  /* ---------- tiny DOM ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---------- filtering & sorting ---------- */
  var BANDS = {
    all: [0, Infinity],
    '100m': [1e8, Infinity],
    '25m': [2.5e7, 1e8],
    '5m': [5e6, 2.5e7],
    '0': [0, 5e6],
  };
  function visible() {
    var band = BANDS[state.band] || BANDS.all;
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.implied_value_usd < band[0] || r.implied_value_usd >= band[1]) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sorted(list) {
    var key = state.sort;
    var val = function (r) {
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -Infinity : r.age_days;
      if (key === 'multiple') return r.model.category_multiple;
      return r.implied_value_usd;
    };
    return list.slice().sort(function (a, b) {
      var d = (val(a) - val(b)) * (state.dir < 0 ? -1 : 1);
      if (d !== 0) return d;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  /* ---------- header ---------- */
  function stat(value, label, mint) {
    return el('div', { class: 'stat' }, el('b', { class: mint ? 'mint' : '', text: value }), el('span', { text: label }));
  }
  function header() {
    return el('header', { class: 'head' },
      el('p', { class: 'kicker', text: 'Token Launch Radar · model ' + DATA.model_version }),
      el('h1', null, 'Pre-token protocols, ', el('span', { class: 'thin', text: 'priced for launch day' })),
      el('p', { class: 'sub' },
        'Every protocol below ', el('strong', { text: 'records no token' }),
        ' in the snapshot of ' + DATA.as_of + '. The radar prices what a launch would be worth if the record stayed as it is — from the snapshot\'s own market multiples, never from a list of favourite names — and writes the farm plan for each. Click any row for its full arithmetic.'
      ),
      el('div', { class: 'stats' },
        stat(String(DATA.scanned), 'protocols scanned'),
        stat(String(DATA.pretoken), 'record no token'),
        stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'),
        stat(String(DATA.board_size), 'rows ranked', true),
        stat(String(DATA.early_size), 'early finds below the floor'),
        stat(fmtUsd(DATA.aggregate_implied_usd), 'aggregate implied value', true)
      )
    );
  }

  /* ---------- controls ---------- */
  function controls(count) {
    var cats = [];
    var chains = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Uncategorised';
      if (cats.indexOf(c) < 0) cats.push(c);
      (r.chains || []).forEach(function (ch) { chains[ch] = (chains[ch] || 0) + 1; });
    });
    cats.sort();
    var chainNames = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 28);

    var search = el('input', { type: 'search', placeholder: 'Search name, slug, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; renderBoard(); });

    function select(value, options, onChange, label) {
      var s = el('select', { 'aria-label': label });
      options.forEach(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (o[0] === value) opt.setAttribute('selected', 'selected');
        s.appendChild(opt);
      });
      s.addEventListener('change', function () { onChange(s.value); renderBoard(); });
      return s;
    }
    var catSel = select(state.cat, [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), function (v) { state.cat = v; }, 'Filter by category');
    var chainSel = select(state.chain, [['all', 'All chains']].concat(chainNames.map(function (c) { return [c, c]; })), function (v) { state.chain = v; }, 'Filter by chain');
    var bandSel = select(state.band, [['all', 'Any implied value'], ['100m', 'Implied ≥ $100M'], ['25m', 'Implied $25–100M'], ['5m', 'Implied $5–25M'], ['0', 'Implied < $5M']], function (v) { state.band = v; }, 'Filter by implied value band');
    var sortSel = select(state.sort, [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['change', 'Sort: 7d change'], ['age', 'Sort: age'], ['multiple', 'Sort: category multiple']], function (v) { state.sort = v; }, 'Sort the board');
    var dirBtn = el('button', {
      type: 'button', 'aria-label': 'Toggle sort direction',
      style: 'background:var(--panel-2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 11px;font:inherit;font-size:13.5px;cursor:pointer',
      text: state.dir < 0 ? '↓ high first' : '↑ low first',
      onclick: function () { state.dir = -state.dir; renderBoard(); },
    });
    var watch = el('input', { type: 'checkbox', id: 'watchonly' });
    if (state.watch) watch.setAttribute('checked', 'checked');
    watch.addEventListener('change', function () { state.watch = watch.checked; renderBoard(); });

    return el('div', { class: 'controls' },
      search, catSel, chainSel, bandSel, sortSel, dirBtn,
      el('label', { class: 'check', for: 'watchonly' }, watch, ' Watchlist only'),
      el('span', { class: 'count', text: count + ' of ' + DATA.board_size + ' rows' })
    );
  }

  /* ---------- board table ---------- */
  function sortHead(label, key) {
    var mark = state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return el('th', {
      class: 'sortable' + (key !== 'implied' && key !== 'name' ? ' num' : ''), scope: 'col',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        renderBoard();
      },
      text: label + mark,
    });
  }
  function boardTable(list) {
    if (list.length === 0) {
      return el('div', { class: 'board-wrap' }, el('div', { class: 'empty', text: 'No protocol matches that filter. Clear the search or widen the band.' }));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var chg = r.change_7d;
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top' : '',
        onclick: function () { openDetail(r.slug); },
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', { class: 'proto' },
          el('b', { text: r.name }),
          r.on_watchlist
            ? el('span', { class: 'badge watch', text: 'WATCHLIST' })
            : el('span', { class: 'badge early', text: 'EARLY' }),
          el('span', { class: 'slug', text: r.slug })
        ),
        el('td', { class: 'cat' }, el('span', { class: 'chip', text: r.category || 'Uncategorised' })),
        el('td', { class: 'chains', text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (chg === null ? 'flat' : chg >= 0 ? 'pos' : 'neg'), text: fmtPct(chg) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.model.category_multiple) }),
        el('td', { class: 'val', text: fmtUsd(r.implied_value_usd) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'board-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: '#' }),
          sortHead('Protocol', 'implied'),
          el('th', { scope: 'col', text: 'Category' }),
          el('th', { scope: 'col', text: 'Chains' }),
          sortHead('TVL', 'tvl'),
          sortHead('7d', 'change'),
          sortHead('Age', 'age'),
          sortHead('× TVL', 'multiple'),
          sortHead('Implied value', 'implied')
        )),
        tbody
      )
    );
  }

  /* ---------- detail drawer ---------- */
  var drawerHost = el('div');
  function closeDetail() {
    state.open = null;
    drawerHost.textContent = '';
  }
  function mathRow(label, why, value) {
    return el('tr', null,
      el('td', null, label, el('span', { class: 'why', text: why })),
      el('td', { text: value })
    );
  }
  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.open = slug;
    var m = row.model;
    var drawer = el('aside', { class: 'drawer', 'aria-label': 'Protocol detail' },
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close detail', text: '✕', onclick: closeDetail }),
      el('p', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · watchlist' : ' · early find') }),
      el('h2', { text: row.name }),
      el('p', { class: 'dslug', text: row.slug + ' · ' + (row.category || 'Uncategorised') + ' · records no token' }),
      el('div', { class: 'grid' },
        el('div', { class: 'cell' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'cell' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'cell' }, el('span', { text: '7d TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', { class: 'cell' }, el('span', { text: 'Running, no token' }), el('b', { text: fmtAge(row.age_days) }))
      ),
      el('h3', { text: 'Chains' }),
      el('div', { class: 'chainchips' }, (row.chains || []).map(function (c) { return el('span', { class: 'chip', text: c }); })),
      el('h3', { text: 'The arithmetic' }),
      el('table', { class: 'math' },
        mathRow('TVL', 'the snapshot\'s figure', fmtFull(row.tvl_usd)),
        mathRow('Category multiple', (row.category || 'Uncategorised') + ': median ' + (m.category_median === null ? 'none observed' : fmtMult(m.category_median)) + ' across ' + m.category_tokenized_n + ' tokenised, shrunk toward the global median ' + fmtMult(DATA.global_median_multiple), fmtFactor(m.category_multiple)),
        mathRow('Momentum', '7d change ' + fmtPct(row.change_7d) + ', clamped at ±30%', fmtFactor(m.momentum)),
        mathRow('Maturity', row.age_days === null ? 'no listing date on record' : row.age_days + ' days with no token', fmtFactor(m.maturity)),
        mathRow('Breadth', (row.chains || []).length + ' chains', fmtFactor(m.breadth)),
        mathRow('Size', 'large TVL is worth less per dollar', fmtFactor(m.size)),
        el('tr', { class: 'total' }, el('td', { text: 'Implied launch value' }), el('td', { text: fmtFull(row.implied_value_usd) }))
      ),
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { class: 'note', text: 'First tracked ' + (row.listed_at || 'on an unrecorded date') + '. Implied value is this radar\'s own claim from the snapshot\'s figures — not a price, and not a promise of a launch.' })
    );
    drawerHost.textContent = '';
    drawerHost.appendChild(el('div', { class: 'scrim', onclick: closeDetail }));
    drawerHost.appendChild(drawer);
  }

  /* ---------- methodology table & live strip ---------- */
  function catTable() {
    var host = document.getElementById('catTable');
    if (!host) return;
    var tbody = el('tbody');
    DATA.categories.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'n', text: String(c.tokenized_n) }),
        el('td', { class: 'n', text: c.median_multiple === null ? '—' : fmtMult(c.median_multiple) }),
        el('td', { class: 'n', text: fmtMult(c.multiple) }),
        el('td', { class: 'n', text: String(c.pretoken_n) })
      ));
    });
    host.appendChild(el('table', { class: 'cats' },
      el('thead', null, el('tr', null,
        el('th', { text: 'Category' }), el('th', { class: 'n', text: 'Tokenised n' }),
        el('th', { class: 'n', text: 'Median ×TVL' }), el('th', { class: 'n', text: 'Multiple used' }),
        el('th', { class: 'n', text: 'Pre-token n' })
      )),
      tbody
    ));
  }
  function liveStrip() {
    var host = document.getElementById('liveStrip');
    if (!host) return;
    host.className = 'live';
    host.appendChild(el('h2', { text: 'Already trading — kept off the board' }));
    host.appendChild(el('p', { text: 'These protocols\' tokens exist, so the market has priced them and there is nothing to radar. They are shown at the market\'s own values — and they are the evidence base: their market-cap-to-TVL multiples are what price the board above.' }));
    host.appendChild(el('div', { class: 'live-grid' }, DATA.live.map(function (r) {
      return el('div', { class: 'live-card' },
        el('b', { text: r.name }), el('span', { class: 'sym', text: r.symbol || '' }),
        el('div', { class: 'row' }, el('span', { text: 'mcap' }), el('span', { text: fmtUsd(r.mcap_usd) })),
        el('div', { class: 'row' }, el('span', { text: 'TVL' }), el('span', { text: fmtUsd(r.tvl_usd) })),
        el('div', { class: 'row' }, el('span', { text: '×TVL' }), el('span', { text: fmtMult(r.multiple) }))
      );
    })));
  }

  /* ---------- render ---------- */
  var boardHost = el('div');
  function renderBoard() {
    var list = sorted(visible());
    boardHost.textContent = '';
    boardHost.appendChild(controls(list.length));
    boardHost.appendChild(boardTable(list));
  }
  app.appendChild(header());
  app.appendChild(boardHost);
  app.appendChild(drawerHost);
  renderBoard();
  catTable();
  liveStrip();
  if (state.open) openDetail(state.open);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
})();
