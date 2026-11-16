// Launch Radar page: renders only what main.ts computed into data.js.
// No fetch, no imports, no network — the file beside this page is the dataset.
(function () {
  'use strict';
  var R = window.RADAR;
  var boardEl = document.getElementById('board');
  var detailEl = document.getElementById('detail');
  if (!R) { boardEl.innerHTML = '<p class="empty">No data. Run main.ts first.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '<span class="num">—</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="num ' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function tags(list, max) {
    var shown = list.slice(0, max).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('');
    return list.length > max ? shown + '<span class="tag">+' + (list.length - max) + ' more</span>' : shown;
  }

  // ---- summary panel: four figures, all from the dataset ----
  var covered = R.rows.filter(function (r) { return r.in_watchlist; }).length;
  $('mver').textContent = R.model_version;
  $('summary').innerHTML =
    '<div class="stat"><b>' + R.protocol_count + '</b><span>protocols in the snapshot</span></div>' +
    '<div class="stat teal"><b>' + money(R.total_tvl_usd) + '</b><span>total TVL they hold</span></div>' +
    '<div class="stat"><b>' + money(R.median_implied_usd) + '</b><span>median implied value on the board</span></div>' +
    '<div class="stat teal"><b>' + covered + ' / ' + R.watchlist_size + '</b><span>watchlist slugs on the board</span></div>';

  $('model-body').innerHTML =
    '<p><b>Peer price first.</b> The live protocols in this same snapshot trade at a median of <b>' +
    R.global_peer_multiple.toFixed(3) + '&times; TVL</b>. Each category reprices that from its own live peers, ' +
    'shrunk toward the global median so thin categories cannot dominate, and clamped so no single category prices a row alone.</p>' +
    '<p><b>Then three adjustments.</b> One week of TVL growth, clamped to &plusmn;40% and damped, because a week is weather, not climate. ' +
    'Survival: credit grows with the square root of tokenless age, so the first year counts most. Breadth: a small capped credit per doubling of the chain count. ' +
    'Unknown listing dates borrow the pre-token cohort&rsquo;s median age, measured from the snapshot &mdash; nothing is read from a clock, and the same snapshot always produces the same board.</p>' +
    '<p><b>Pre-token and live never mix.</b> The board ranks only protocols with no token recorded. Protocols that already trade appear in the token-status view at the market&rsquo;s own market cap &mdash; they are the yardstick, not the ranked.</p>';

  $('foot').textContent = 'Snapshot as of ' + R.as_of + ' · Source: ' + R.source + ' · Board: ' + R.board_size +
    ' pre-token protocols (' + R.watchlist_size + ' watchlist + ' + R.extra_size + ' found below the floor) · Model ' + R.model_version +
    ' · Every figure on this page was computed by main.ts from that snapshot.';

  // ---- filters ----
  var catSet = {}, chainSet = {};
  R.rows.concat(R.live).forEach(function (r) {
    if (r.category) catSet[r.category] = 1;
    (r.chains || []).forEach(function (c) { chainSet[c] = 1; });
  });
  Object.keys(catSet).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('fcat').appendChild(o);
  });
  Object.keys(chainSet).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('fchain').appendChild(o);
  });

  var selectedSlug = null;

  function matches(r, isLive) {
    var q = $('q').value.trim().toLowerCase();
    if (q) {
      var hay = (r.name + ' ' + r.slug + ' ' + (r.chains || []).join(' ') + ' ' + (r.symbol || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if ($('fcat').value && r.category !== $('fcat').value) return false;
    if ($('fchain').value && (r.chains || []).indexOf($('fchain').value) === -1) return false;
    return true;
  }

  function sortedRows(rows, isLive) {
    var mode = $('fsort').value;
    var out = rows.slice();
    if (mode === 'tvl') out.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (mode === 'implied' && !isLive) out.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    else if (mode === 'implied' && isLive) out.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    else if (mode === 'growth') out.sort(function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); });
    else if (!isLive) out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function render() {
    var isLive = $('ftoken').value === 'live';
    var rows = sortedRows((isLive ? R.live : R.rows).filter(function (r) { return matches(r, isLive); }), isLive);
    $('count').textContent = rows.length + (isLive ? ' live-token protocols' : ' pre-token protocols ranked') +
      (isLive ? ' — shown at market value, not ranked' : ' · snapshot ' + R.as_of);
    if (rows.length === 0) {
      boardEl.innerHTML = '<p class="empty">Nothing matches those filters. Loosen the search or clear a filter.</p>';
      return;
    }
    var head = isLive
      ? '<tr><th>Protocol</th><th>Symbol</th><th class="hidem">Category</th><th>TVL</th><th>Market cap</th><th>7d</th><th class="hidem">Pays per $1 TVL</th></tr>'
      : '<tr><th>Rank</th><th>Protocol</th><th class="hidem">Category</th><th>TVL</th><th>7d</th><th>Implied value</th><th class="hidem">Confidence</th></tr>';
    var body = rows.map(function (r) {
      if (isLive) {
        var ratio = r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + '&times;' : '—';
        return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" aria-selected="' + (r.slug === selectedSlug) + '">' +
          '<td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span><br>' + tags(r.chains, 2) + '</td>' +
          '<td class="num">' + esc(r.symbol || '—') + '</td>' +
          '<td class="hidem">' + esc(r.category || '—') + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num">' + money(r.mcap_usd) + '</td>' +
          '<td>' + pct(r.change_7d) + '</td>' +
          '<td class="num hidem">' + ratio + '</td></tr>';
      }
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" aria-selected="' + (r.slug === selectedSlug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.in_watchlist ? ' <span class="tag watch">watchlist</span>' : '') +
        '<br><span class="pslug">' + esc(r.slug) + '</span><br>' + tags(r.chains, 3) + '</td>' +
        '<td class="hidem">' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td>' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="hidem"><span class="conf ' + r.confidence + '">' + r.confidence + '</span></td></tr>';
    }).join('');
    boardEl.innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    Array.prototype.forEach.call(boardEl.querySelectorAll('tr[data-slug]'), function (tr) {
      var open = function () { showDetail(tr.getAttribute('data-slug'), isLive); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  function showDetail(slug, isLive) {
    selectedSlug = slug;
    var pool = isLive ? R.live : R.rows;
    var r = null;
    pool.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    render();
    if (isLive) {
      detailEl.innerHTML = '<div class="detail"><div class="dhead"><h2>' + esc(r.name) + '</h2>' +
        '<button class="dclose" id="dclose">CLOSE</button></div>' +
        '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · already trading as ' + esc(r.symbol || 'its token') + ' — the market prices it, the model does not.</p>' +
        '<div class="factors">' +
        '<div class="factor"><b>' + money(r.tvl_usd) + '</b><span>TVL in the snapshot</span></div>' +
        '<div class="factor"><b>' + money(r.mcap_usd) + '</b><span>market cap, the market&rsquo;s own value</span></div>' +
        '<div class="factor"><b>' + (r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + '&times;' : '—') + '</b><span>paid per $1 of TVL — the yardstick for its pre-token peers</span></div>' +
        '<div class="factor"><b>' + (r.change_7d == null ? '—' : r.change_7d.toFixed(1) + '%') + '</b><span>TVL change, 7 days</span></div></div>' +
        '<p class="sub">Chains: ' + esc(r.chains.join(', ') || 'none recorded') + '</p></div>';
    } else {
      var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      detailEl.innerHTML = '<div class="detail"><div class="dhead"><h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
        '<button class="dclose" id="dclose">CLOSE</button></div>' +
        '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.slug) + (r.in_watchlist ? ' · on the watchlist' : ' · found below the watchlist floor') +
        ' · listed ' + esc(r.listed_at || 'date unknown') + (r.age_days == null ? '' : ' · ' + r.age_days + ' days tokenless') +
        ' · confidence <span class="conf ' + r.confidence + '">' + r.confidence + '</span></p>' +
        '<p class="formula">' + money(r.tvl_usd) + ' TVL &times; ' + r.peer_multiple.toFixed(3) + ' peer price &times; ' +
        r.growth_multiplier.toFixed(2) + ' growth &times; ' + r.maturity_multiplier.toFixed(2) + ' survival &times; ' +
        r.breadth_multiplier.toFixed(2) + ' breadth &asymp; ' + money(r.implied_value_usd) + ' implied</p>' +
        '<div class="factors">' +
        '<div class="factor"><b>' + r.peer_multiple.toFixed(3) + '&times;</b><span>peer price for ' + esc(r.category || 'its category') + ', from ' + r.peer_sample + ' live peers</span></div>' +
        '<div class="factor"><b>' + r.growth_multiplier.toFixed(2) + '&times;</b><span>one week of TVL growth, damped</span></div>' +
        '<div class="factor"><b>' + r.maturity_multiplier.toFixed(2) + '&times;</b><span>survival, tokenless ' + (r.age_days == null ? 'age unknown' : r.age_days + ' days') + '</span></div>' +
        '<div class="factor"><b>' + r.breadth_multiplier.toFixed(2) + '&times;</b><span>breadth across ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span></div></div>' +
        '<p class="sub">Chains: ' + esc(r.chains.join(', ') || 'none recorded') + '</p>' +
        '<h3 style="font-family:Georgia,serif;font-weight:400;margin:0 0 10px">The farm plan</h3>' +
        '<ol class="steps">' + steps + '</ol></div>';
    }
    var close = $('dclose');
    if (close) close.addEventListener('click', function () { detailEl.innerHTML = ''; selectedSlug = null; render(); });
    detailEl.scrollIntoView({ block: 'nearest' });
  }

  ['q', 'fcat', 'fchain', 'ftoken', 'fsort'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
})();
