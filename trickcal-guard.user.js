// ==UserScript==
// @name         トリッカル もちもちワンクッション（ネタバレ回避）
// @namespace    tg-guard
// @version      0.3.24
// @description  トリッカルの先行版（本国版）の内容を投稿しているアカウントの投稿をぼかし、クリックで表示するワンクッションを X に追加するネタバレ回避スクリプト。判定はアカウント単位。「報告」ボタンを押したときだけ、その投稿の情報を送信します。
// @author       anonymous
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      docs.google.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // ────────────────────────────────────────────────────────────────
  // 0. 設定定数 — 配布前に触るのはここだけ
  // ────────────────────────────────────────────────────────────────

  // 報告の送信先: 'form' | 'none'
  // 'none' の場合は送信せずローカル(tg_pending)に溜める。開発・テスト用。
  const SEND_MODE = 'form';

  // 判定結果をコンソールに出す。原因調査が終わったら false に。
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[tg]', ...a);
  // 設定パネルに出す版数。ヘッダの @version をそのまま使う（二重管理しない）
  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '';

  // Google フォーム: 「事前入力したリンクを取得」で entry.ID を確認して埋める
  const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdBFHFRtQcp1sBq49UNkYV_bTlpRrBPA7sIY5vSvJX0nc2jlQ/formResponse';
  const FORM_FIELDS = {
    user:     'entry.2120562442',
    reposter: 'entry.307293834',
    link:     'entry.1477113937',
    date:     'entry.2050821820',
    text:     'entry.1290347790',
    imgs:     'entry.1028905437',
    iid:      'entry.1421019080',
  };

  const DAILY_LIMIT = 20;   // 1日の報告上限（超えたら confirm）
  const TEXT_LIMIT = 1000;  // 送信する本文の最大長

  // 配布リスト — SHA-256(小文字ハンドル + SALT) の hex。リモート(REMOTE_URL)から読む。
  const SALT = 'tg-2026-09-19-v0';
  // リモート配布リスト — 閲覧可のシートの先頭タブ(gid=0)を CSV で読む。
  // '' なら配布リストを使わない（この端末のリストだけで動く）。
  const REMOTE_URL = 'https://docs.google.com/spreadsheets/d/1v6kSLDZTibIPrW3r4CJ8Bw_s7_cQF0PhZPaOnu3_7Rk/gviz/tq?tqx=out:csv&gid=0';
  const REMOTE_TTL = 6 * 60 * 60 * 1000;      // キャッシュ有効 6 時間
  const REMOTE_RETRY = 30 * 60 * 1000;         // 通信エラー・タイムアウト後の再試行間隔
  const REMOTE_EMPTY_RETRY = 6 * 60 * 60 * 1000;   // 応答はあったがリストが取れなかったときの再試行間隔
  const REMOTE_CHECK = 30 * 60 * 1000;         // 開いたままのタブが期限切れを確かめる間隔
  const REMOTE_BUSY_RETRY = 2 * 60 * 1000;     // シートが再計算中だったときの再試行間隔
  const REMOTE_BUSY_MAX = 3;                   // 再計算中が続いたら、この回数で打ち切って長めに待つ

  let DIST = new Set();                        // 実際の判定に使う集合（キャッシュ・リモート読込で差し替え）
  let DIST_SRC = 'none';                       // 'none' | 'cache' | 'remote'
  let DIST_TS = 0;

  // ────────────────────────────────────────────────────────────────
  // 1. セレクタ — X の DOM が変わったらまずここを見る
  // ────────────────────────────────────────────────────────────────
  const SEL = {
    article:       'article[data-testid="tweet"]',
    userName:      '[data-testid="User-Name"]',        // 投稿者ブロック。引用カード内にももう一つある（そちらはリンク無しで @テキストのみ）
    socialContext: '[data-testid="socialContext"]',    // 「○○さんがリポスト」の行。通常 a[href="/handle"] の中にある
    quoteBox:      'div[role="link"]',                 // 引用カードのコンテナ（userName から closest で辿る）
    tweetText:     '[data-testid="tweetText"]',
    photo:         '[data-testid="tweetPhoto"]',
    video:         '[data-testid="videoPlayer"]',
    card:          '[data-testid="card.wrapper"]',
    actionBar:     '[role="group"]',                   // 返信・RP・いいねの行
    avatar:        '[data-testid="Tweet-User-Avatar"]',
    permalinkAnchor: 'a[href*="/status/"]',            // このうち <time> を含むものが本文のパーマリンク
    cushionLinks:  'a[href*="fusetter.com"], a[href*="poipiku.com"], a[href*="privatter.net"]',
  };
  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/;
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose']);

  // ────────────────────────────────────────────────────────────────
  // 2. ストレージ
  // ────────────────────────────────────────────────────────────────
  const store = {
    get: (k, d) => { try { return JSON.parse(GM_getValue(k, JSON.stringify(d))); } catch { return d; } },
    set: (k, v) => GM_setValue(k, JSON.stringify(v)),
  };
  const asList = v => (Array.isArray(v) ? v : []);
  const asMap  = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});   // 配列だとキーが保存されないので捨てる
  const CLICKS_DEFAULT = 2;
  const CFG_DEFAULT = { dist: true, cushion: true, clicks: CLICKS_DEFAULT };
  const local = new Set();      // ユーザーが自分で追加したアカウント（小文字・平文）
  const white = new Set();      // 常に表示
  const cfg = {};
  const reported = {};          // url -> ts
  let iid = GM_getValue('tg_iid', '');
  if (!iid) { iid = crypto.randomUUID(); GM_setValue('tg_iid', iid); }

  // 保存値 → メモリ。タブを複数開いていると他のタブも書き込むので、起動時だけでなく書く直前にも読み直す
  function pull() {
    local.clear(); asList(store.get('tg_local', [])).forEach(h => local.add(h));
    white.clear(); asList(store.get('tg_white', [])).forEach(h => white.add(h));
    for (const k of Object.keys(cfg)) delete cfg[k];
    Object.assign(cfg, CFG_DEFAULT, asMap(store.get('tg_cfg', {})));
    for (const k of Object.keys(reported)) delete reported[k];
    Object.assign(reported, asMap(store.get('tg_reported', {})));
  }
  pull();
  const snap = () => ({
    tg_local: JSON.stringify([...local]), tg_white: JSON.stringify([...white]),
    tg_cfg: JSON.stringify(cfg), tg_reported: JSON.stringify(reported),
  });
  // リスト・設定・報告履歴の変更は必ずここを通す: 読み直す → fn で差分だけ当てる → 変わったキーだけ書く。
  // メモリの中身を丸ごと書くと、他のタブが入れた変更を消してしまう
  function edit(fn) {
    pull();
    const before = snap();
    fn();
    const after = snap();
    for (const k of Object.keys(after)) if (after[k] !== before[k]) GM_setValue(k, after[k]);
  }

  const revealed = new Map();   // このセッションで表示にした投稿 id -> 該当したハンドル
  const steps = new Map();      // 途中まで押した投稿 id -> { step: 押した回数, hs: 該当したハンドル }
  // リストが変わったら、そのアカウントに関わる表示記録を消す（戻したら再びぼかすため）
  const forgetRevealed = h => {
    for (const [id, hs] of revealed) if (hs.includes(h)) revealed.delete(id);
    for (const [id, v] of steps) if (v.hs.includes(h)) steps.delete(id);
  };
  // その投稿の途中経過・表示済みを消す（引用カードだけ表示していた投稿の投稿者を、先行版扱いにしたとき）
  const forgetPost = id => { if (id) { revealed.delete(id); steps.delete(id); } };
  let version = 0;              // リストが変わったら上げて全件を再判定

  // ────────────────────────────────────────────────────────────────
  // 2a. 通信 — クッキーを付けずに送る（anonymous）。
  //     anonymous にすると fetch モードになり、Chrome では timeout が効かないので、時間切れは自前でも数える。
  //     onload / onerror / ontimeout のどれか一つが、一度だけ呼ばれる
  // ────────────────────────────────────────────────────────────────
  const REQ_TIMEOUT = 15000;
  function request(o) {
    let done = false, timer = 0, req = null;
    const once = fn => (...a) => { if (done) return; done = true; clearTimeout(timer); if (fn) fn(...a); };
    timer = setTimeout(once(() => { try { req?.abort?.(); } catch {} if (o.ontimeout) o.ontimeout(); }), REQ_TIMEOUT);
    req = GM_xmlhttpRequest({
      method: o.method, url: o.url, data: o.data, headers: o.headers, anonymous: true, timeout: REQ_TIMEOUT,
      onload: once(o.onload), onerror: once(o.onerror), onabort: once(o.onerror), ontimeout: once(o.ontimeout),
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 2b. リモート配布リストの読込（リモートが取れない間はキャッシュを使い続ける。どちらも無ければ配布リストなし）
  // ────────────────────────────────────────────────────────────────
  const HEX64 = /^[0-9a-f]{64}$/;
  function parseHashCsv(text) {
    return [...new Set(text.split(/\r?\n/).map(l => l.trim().replace(/^"|"$/g, '').toLowerCase()).filter(l => HEX64.test(l)))];
  }
  // キャッシュ → メモリ。中身が入れ替わったら true（他のタブが取ってきた新しいリストもここから入る）
  function loadRemoteCache() {
    const c = store.get('tg_remote', null);
    if (!c || !Array.isArray(c.hashes) || !c.hashes.length) return false;
    if (DIST_SRC !== 'none' && (c.ts || 0) === DIST_TS) return false;   // いま使っているものと同じ
    DIST = new Set(c.hashes); DIST_SRC = 'cache'; DIST_TS = c.ts || 0;
    return true;
  }
  function fetchRemote(force) {
    if (!REMOTE_URL) return;
    if (loadRemoteCache()) bump();   // 他のタブが先に更新していれば、取りに行かずそれを使う
    const now = Date.now();
    if (!force) {
      if (DIST_SRC !== 'none' && now - DIST_TS < REMOTE_TTL) return;   // キャッシュがまだ有効
      if (now < GM_getValue('tg_remote_next', 0)) return;                   // 直近で失敗・空応答、しばらく待つ
    }
    // tg_remote_next = この時刻までは取りに行かない（全タブ共通）。
    // 応答を待つ間に他のタブが重ねて取りに行かないよう、先に短いほうを入れておく。通信エラー・タイムアウトならこのまま
    GM_setValue('tg_remote_next', now + REMOTE_RETRY);
    request({
      method: 'GET', url: REMOTE_URL,
      onload: r => {
        const text = r.status === 200 ? String(r.responseText || '') : '';
        // シートの再計算中は、行が一時的に #NAME? などのエラー値で返ることがある（全部の行とは限らない）。
        // その応答は一部でも使わず、既存リストのまま少し待って取り直す
        if (/^"?#/m.test(text)) {
          const n = GM_getValue('tg_remote_busy', 0) + 1;
          GM_setValue('tg_remote_busy', n);
          const wait = n <= REMOTE_BUSY_MAX ? REMOTE_BUSY_RETRY : REMOTE_EMPTY_RETRY;
          GM_setValue('tg_remote_next', now + wait);
          if (n <= REMOTE_BUSY_MAX) setTimeout(() => fetchRemote(false), wait + 1000);
          log('remote busy', n);
          return;
        }
        GM_setValue('tg_remote_busy', 0);
        const hashes = parseHashCsv(text);
        if (!hashes.length) {
          // 応答はあったがリストが取れない（リストが空・シートの不調・アクセス制限など）。
          // すぐには直らないので既存リストを維持したまま長めに待つ
          GM_setValue('tg_remote_next', now + REMOTE_EMPTY_RETRY);
          log('remote empty/failed', r.status);
          return;
        }
        DIST = new Set(hashes); DIST_SRC = 'remote'; DIST_TS = now;
        store.set('tg_remote', { ts: now, hashes });
        hcache.clear();
        bump();
        log('remote loaded', hashes.length);
      },
      onerror: () => log('remote error'),
      ontimeout: () => log('remote timeout'),
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 3. ハッシュ照合
  // ────────────────────────────────────────────────────────────────
  const hcache = new Map();
  // サンドボックスに crypto.subtle が無ければページ側のものを使う
  const subtle = (globalThis.crypto && globalThis.crypto.subtle)
    || (typeof unsafeWindow !== 'undefined' && unsafeWindow.crypto && unsafeWindow.crypto.subtle)
    || null;
  if (!subtle) console.error('[tg] crypto.subtle が見つからない。配布リストの照合は動作しない。');
  function hashOf(h) {
    let p = hcache.get(h);
    if (!p) {
      p = subtle
        ? subtle.digest('SHA-256', new TextEncoder().encode(h + SALT))
            .then(buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''))
            .catch(err => { console.error('[tg] hash failed', h, err); return ''; })
        : Promise.resolve('');
      hcache.set(h, p);
    }
    return p;
  }
  async function isListed(h) {
    if (!h) return false;
    if (white.has(h)) return false;
    if (local.has(h)) return true;
    if (!cfg.dist) return false;
    const hx = await hashOf(h);
    return !!hx && DIST.has(hx);
  }

  // ────────────────────────────────────────────────────────────────
  // 4. DOM からの情報抽出
  // ────────────────────────────────────────────────────────────────
  const AT_RE = /^@([A-Za-z0-9_]{1,15})$/;
  function handleFromLinks(root) {
    if (!root) return null;
    for (const a of root.querySelectorAll('a[href^="/"]')) {
      const m = a.getAttribute('href').match(HANDLE_RE);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1].toLowerCase();
    }
    // 引用カード内の User-Name にはリンクが無く "@handle" のテキストだけ（カード全体が role="link"）
    for (const sp of root.querySelectorAll('span')) {
      const m = sp.textContent.trim().match(AT_RE);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }
  function reposterOf(article) {
    const sc = article.querySelector(SEL.socialContext);
    if (!sc) return null;
    const a = sc.closest('a[href^="/"]');
    if (a) { const m = a.getAttribute('href').match(HANDLE_RE); if (m) return m[1].toLowerCase(); }
    return handleFromLinks(sc.parentElement);
  }
  function permalinkOf(article) {
    for (const a of article.querySelectorAll(SEL.permalinkAnchor)) {
      if (a.querySelector('time')) return a.href.split('?')[0];
    }
    return null;
  }
  const idOf = url => (url && url.match(/\/status\/(\d+)/) || [])[1] || null;

  function parts(article) {
    const blocks = [...article.querySelectorAll(SEL.userName)];
    const authorBlock = blocks[0] || null;
    const quoteBlock  = blocks.length > 1 ? blocks[blocks.length - 1] : null;
    return {
      author:   handleFromLinks(authorBlock),
      quoted:   handleFromLinks(quoteBlock),
      quoteBox: quoteBlock ? quoteBlock.closest(SEL.quoteBox) : null,
      reposter: reposterOf(article),
      link:     permalinkOf(article),
    };
  }
  function collectForReport(article) {
    const p = parts(article);
    // 引用カードの中身は投稿者のものではないので混ぜない。
    // 引用元の本文は [引用 @handle] を付けて本文の後ろに足し、引用元の画像は送らない
    const own = sel => [...article.querySelectorAll(sel)].filter(el => !p.quoteBox || !p.quoteBox.contains(el));
    const time = own('time')[0];
    let text = own(SEL.tweetText)[0]?.innerText ?? '';
    const qText = p.quoteBox?.querySelector(SEL.tweetText)?.innerText ?? '';
    if (qText) text += `${text ? '\n' : ''}[引用${p.quoted ? ' @' + p.quoted : ''}] ${qText}`;
    // 画像は img.src、動画・GIF は <video poster>、リンクカード（YouTube 等）はカード内の img
    const imgs = [...new Set([
      ...own(`${SEL.photo} img`).map(i => i.src),
      ...own('video[poster]').map(v => v.poster),
      ...own(`${SEL.card} img`).map(i => i.src),
    ].filter(u => u && /^https?:/.test(u)).map(u => u.replace(/([?&])name=\w+/, '$1name=medium')))];
    return {
      user: p.author, reposter: p.reposter, link: p.link,
      date: time?.getAttribute('datetime') || '',
      text: text.slice(0, TEXT_LIMIT), imgs, iid,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // 5. ぼかし / 表示
  // ────────────────────────────────────────────────────────────────
  // 表示までのクリック数 n (設定 1〜5) と、ぼかしの強さ(px)の段階。
  //   n = 1      : 1 回で全部表示
  //   n >= 2     : 最後の 1 回で画像・動画・カード、その前の 1 回で本文
  //   n >= 3     : さらにその前の (n - 2) 回で、ぼかしが BLUR_MAX から BLUR_MIN まで段階的に弱くなる
  const BLUR_MAX = 28, BLUR_MIN = 10, CLICKS_MAX = 5;
  const clicksOf = () => { const n = Math.round(Number(cfg.clicks)); return n >= 1 && n <= CLICKS_MAX ? n : CLICKS_DEFAULT; };
  const blurLevels = n => {
    const k = Math.max(0, n - 2);
    return Array.from({ length: k + 1 }, (_, i) => Math.round(BLUR_MAX - (k ? (BLUR_MAX - BLUR_MIN) * i / k : 0)));
  };
  const MEDIA_SEL = `${SEL.photo}, ${SEL.video}, ${SEL.card}`;
  const under = (p, sels) => sels.map(x => `${p} ${x}`).join(', ');
  const BLUR_TARGETS = [SEL.photo, SEL.tweetText, SEL.video, SEL.card];
  const WEAKER = [...new Set([3, 4, 5].flatMap(blurLevels))].filter(v => v !== BLUR_MAX);

  GM_addStyle(`
    /* X は hover のたびに article の className を書き直すので class は使えない。data 属性で印を付ける */
    [data-tg-blur] { position: relative; }
    /* pointer-events は残す: クリックは capture で横取りして「表示」にする。
       none にすると click の target が親になり、どこを押したか判別できない。
       clip-path はぼかしのにじみを要素の外（名前の行など）に出さないため */
    ${under('[data-tg-blur]', BLUR_TARGETS)} {
      filter: blur(${BLUR_MAX}px); clip-path: inset(0); user-select: none; cursor: pointer;
    }
    ${WEAKER.map(v => `${under(`[data-tg-blur="${v}"]`, BLUR_TARGETS)} { filter: blur(${v}px); }`).join('\n    ')}
    /* 本文だけ先に表示した段階 */
    [data-tg-blur][data-tg-text] ${SEL.tweetText} { filter: none; clip-path: none; user-select: auto; cursor: inherit; }
    [data-tg-blur]::after {
      content: '先行版の内容が含まれる可能性があります — クリックで表示';
      position: absolute; left: 50%; top: 55%; transform: translate(-50%, -50%);
      background: rgba(0,0,0,.65); color: #fff; padding: 6px 12px; border-radius: 16px;
      font-size: 13px; white-space: nowrap; pointer-events: none; z-index: 3;
    }
    [data-tg-blur][data-tg-left]::after { content: '先行版の内容が含まれる可能性があります — あと ' attr(data-tg-left) ' 回クリックで表示'; }
    [data-tg-blur][data-tg-text]::after { top: 75%; }
    .tg-btn { font-size: 11px; opacity: .4; margin-left: 10px; background: none; border: 0;
              color: inherit; cursor: pointer; font-family: inherit; padding: 0; white-space: nowrap;
              flex: 0 1 auto; min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
    .tg-btn:hover { opacity: 1; }
    .tg-btn[disabled] { cursor: default; opacity: .6; }
    #tg-panel { position: fixed; top: 60px; right: 20px; z-index: 99999; width: 340px;
      box-sizing: border-box; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto;
      background: #1e1e1e; color: #eee; border: 1px solid #555; border-radius: 8px;
      padding: 12px; font-size: 12px; font-family: system-ui, sans-serif; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
    #tg-panel textarea { width: 100%; height: 90px; background: #111; color: #eee; border: 1px solid #444;
      font-family: monospace; font-size: 11px; box-sizing: border-box; }
    #tg-panel label { display: block; margin: 6px 0 2px; }
    #tg-panel .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    #tg-panel button { cursor: pointer; white-space: nowrap; }
    /* タッチ端末: 押しやすい大きさにし、文言を「タップ」にする */
    @media (pointer: coarse) {
      .tg-btn { font-size: 13px; padding: 8px 2px; opacity: .55; }
      [data-tg-blur]::after { content: '先行版の内容が含まれる可能性があります — タップで表示'; }
      [data-tg-blur][data-tg-left]::after { content: '先行版の内容が含まれる可能性があります — あと ' attr(data-tg-left) ' 回タップで表示'; }
    }
    /* 幅の狭い画面: ラベルは折り返し、設定パネルは画面幅に収める */
    @media (max-width: 500px) {
      [data-tg-blur]::after { white-space: normal; width: max-content; max-width: calc(100% - 32px); text-align: center; box-sizing: border-box; }
      #tg-panel { top: 8px; left: 8px; right: 8px; width: auto; }
    }
  `);

  // article に残す印（すべて data 属性 — React が触らない）
  //   data-tg-blur     : 現在ぼかし中。値はぼかしの強さ(px)
  //   data-tg-text     : ぼかし中だが本文は表示済み
  //   data-tg-left     : 表示までの残りクリック数（2 以上のときだけ）
  //   data-tg-step     : これまでに押した回数（投稿 id が取れないときの控え。普段は steps に持つ）
  //   data-tg-handles  : この投稿で該当したハンドル(JSON)。ぼかし中でも表示後でも保持
  //   data-tg-src      : 投稿者が該当した根拠 'local' | 'dist' | ''
  //   data-tg-revealed : このセッションで表示にした
  const BLUR_ATTRS = ['data-tg-blur', 'data-tg-text', 'data-tg-left', 'data-tg-step'];
  function unblur(article) {
    for (const el of [article, ...article.querySelectorAll('[data-tg-blur]')]) BLUR_ATTRS.forEach(a => el.removeAttribute(a));
  }
  function clearMarks(article) {
    for (const k of ['tgHandles', 'tgSrc', 'tgRevealed']) delete article.dataset[k];
    unblur(article);
  }
  const handlesOf = article => { try { return JSON.parse(article.dataset.tgHandles || '[]'); } catch { return []; } };
  // step = これまでに押した回数。target にその段階の見た目を付ける。全部表示し終える段階なら false を返す
  function applyStep(target, step) {
    const n = clicksOf(), lv = blurLevels(n);
    const total = n >= 2 && !target.querySelector(MEDIA_SEL) ? n - 1 : n;   // 画像などが無ければ本文の表示で終わり
    if (step >= total) return false;
    target.setAttribute('data-tg-blur', String(lv[Math.min(step, lv.length - 1)]));
    if (n >= 2 && step >= n - 1) target.setAttribute('data-tg-text', '1'); else target.removeAttribute('data-tg-text');
    if (total - step > 1) target.setAttribute('data-tg-left', String(total - step)); else target.removeAttribute('data-tg-left');
    return true;
  }
  function reveal(article) {
    unblur(article);
    article.dataset.tgRevealed = '1';
    const id = idOf(permalinkOf(article));
    if (id) { revealed.set(id, handlesOf(article)); steps.delete(id); }
    ensureButtons(article);
  }
  function attachClick(article) {
    if (article.dataset.tgClick) return;
    article.dataset.tgClick = '1';
    article.addEventListener('click', e => {
      const b = e.target.closest('[data-tg-blur]');
      if (!b || !article.contains(b)) return;
      // ぼかしている本文・画像・動画・カードを押したときだけ「表示」。
      // それ以外（名前・…メニュー・アクションバー・余白）は X にそのまま渡す
      const hit = e.target.closest(BLUR_TARGETS.join(', '));
      if (!hit || !b.contains(hit)) return;
      if (b.hasAttribute('data-tg-text') && hit.matches(SEL.tweetText)) return;   // 表示済みの本文は普通の本文として扱う
      e.preventDefault(); e.stopPropagation();
      const id = idOf(permalinkOf(article));
      const step = ((id && steps.get(id)?.step) || Number(b.dataset.tgStep) || 0) + 1;
      if (!applyStep(b, step)) { reveal(article); return; }
      b.dataset.tgStep = String(step);
      if (id) steps.set(id, { step, hs: handlesOf(article) });
    }, true);
  }

  // ────────────────────────────────────────────────────────────────
  // 6. 報告
  // ────────────────────────────────────────────────────────────────
  function todayCount() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return Object.values(reported).filter(ts => ts >= start.getTime()).length;
  }
  function send(r, onFail) {
    if (SEND_MODE === 'form') {
      const body = new URLSearchParams({
        [FORM_FIELDS.user]: r.user || '', [FORM_FIELDS.reposter]: r.reposter || '',
        [FORM_FIELDS.link]: r.link || '', [FORM_FIELDS.date]: r.date,
        [FORM_FIELDS.text]: r.text, [FORM_FIELDS.imgs]: r.imgs.join('\n'), [FORM_FIELDS.iid]: r.iid,
      }).toString();
      request({ method: 'POST', url: FORM_URL, data: body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        onload: res => { if (res.status < 200 || res.status >= 300) { log('report failed', res.status); onFail(); } },
        onerror: () => { log('report error'); onFail(); },
        ontimeout: () => { log('report timeout'); onFail(); } });
    } else {
      const pend = store.get('tg_pending', []); pend.push(r); store.set('tg_pending', pend);
    }
  }
  function report(article) {
    const r = collectForReport(article);
    pull();   // 他のタブで報告済みかもしれない
    if (!r.link || reported[r.link]) { ensureButtons(article); return; }
    if (todayCount() >= DAILY_LIMIT && !confirm(`本日${DAILY_LIMIT}件を超えています。送信しますか？`)) return;
    edit(() => { reported[r.link] = Date.now(); });
    ensureButtons(article);
    // 送信に失敗したら記録を戻し、もう一度「報告」を押せるようにする
    send(r, () => { edit(() => { delete reported[r.link]; }); scan(); });
  }

  // ────────────────────────────────────────────────────────────────
  // 7. アクションバーのボタン — 状態からボタン一覧を求め、変わったときだけ描き直す
  // ────────────────────────────────────────────────────────────────
  //  投稿者の状態          | ボタン
  //  ----------------------|------------------------------------------
  //  未登録                | 先行版扱い            （引用カードだけぼかしている投稿にも出す。対象は投稿者）
  //  ローカルリスト        | 報告 / ✓ · 解除
  //  配布リスト            | （無し）
  //  常に表示              | 戻す
  //  + このセッションで表示 | 根拠がローカルなら「解除 @x」、配布リストなら「常に表示 @x」（狭い画面では後ろが省略されるので動作を先に書く）
  //  表示する文字は短くし、全文は title / aria-label に入れる
  function desiredButtons(article, p) {
    const out = [];
    if (!p.author) return out;
    const a = p.author;
    let hs = []; try { hs = JSON.parse(article.dataset.tgHandles || '[]'); } catch {}
    const blurred = article.hasAttribute('data-tg-blur');
    const src = white.has(a) ? 'white' : local.has(a) ? 'local' : (article.dataset.tgSrc || '');
    if (src === 'white')      out.push('restore');
    else if (src === 'local') out.push(p.link && reported[p.link] ? 'reported' : 'report', 'unlocal');
    else if (src === 'dist')  { /* 既に配布リストにある — 何もしない */ }
    else if (!blurred) out.push('add');
    // 表示後: 根拠がローカルなら「解除」、配布リストなら「常に表示」 — アカウントごとに一つだけ
    if (article.dataset.tgRevealed) {
      for (const h of hs) {
        if (white.has(h)) continue;
        if (local.has(h)) { if (h !== a) out.push('unlocal:' + h); }   // 投稿者は上で既に unlocal 済み
        else out.push('white:' + h);
      }
    }
    return out;
  }
  const BTN = {
    add:      { text: '先行版扱い', title: 'この端末で先行版扱いにする（送信しません）',
                run: (a, p) => { edit(() => local.add(p.author)); forgetRevealed(p.author); forgetPost(idOf(p.link)); bump(); } },
    report:  { text: '報告', title: '先行版の内容として報告する',
                run: (a) => report(a) },
    reported: { text: '✓', title: '報告済み', disabled: true },
    unlocal:  { text: '解除', title: 'この端末の先行版扱いを解除する',
                run: (a, p) => { edit(() => local.delete(p.author)); forgetRevealed(p.author); bump(); } },
    restore:  { text: '戻す', title: '「常に表示」をやめて、通常の判定に戻す',
                run: (a, p) => { edit(() => white.delete(p.author)); forgetRevealed(p.author); bump(); } },
  };
  function ensureButtons(article) {
    const bar = article.querySelector(SEL.actionBar);
    if (!bar) return;
    const p = parts(article);
    const want = desiredButtons(article, p);
    const key = want.join(',');
    if (bar.dataset.tgBtns === key) return;
    bar.dataset.tgBtns = key;
    bar.querySelectorAll('.tg-btn').forEach(b => b.remove());
    for (const w of want) {
      const b = document.createElement('button');
      b.className = 'tg-btn';
      let spec;
      if (w.startsWith('white:')) {
        const h = w.slice(6);
        spec = { text: `常に表示 @${h}`, title: `この端末で @${h} を常に表示する（配布リストの例外）`,
                 run: () => { edit(() => white.add(h)); bump(); } };
      } else if (w.startsWith('unlocal:')) {
        const h = w.slice(8);
        spec = { text: `解除 @${h}`, title: `この端末の @${h} の先行版扱いを解除する`,
                 run: () => { edit(() => local.delete(h)); forgetRevealed(h); bump(); } };
      } else spec = BTN[w];
      b.textContent = spec.text; b.title = spec.title || '';
      if (spec.title) b.setAttribute('aria-label', spec.title);   // 表示は短く、読み上げは title と同じ全文
      if (spec.disabled) b.disabled = true;
      else b.onclick = e => { e.stopPropagation(); e.preventDefault(); spec.run(article, p); };
      bar.appendChild(b);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 8. 判定ループ
  // ────────────────────────────────────────────────────────────────
  async function evaluate(article) {
    const p = parts(article);
    const id = idOf(p.link);
    clearMarks(article);
    attachClick(article);
    if (!p.author) {
      // 投稿者ブロックがまだ無い — キーを外して次のスキャンで見直す
      delete article.dataset.tgKey;
      log('author null, retry later', article);
      return;
    }
    if (cfg.cushion && article.querySelector(SEL.cushionLinks)) { log('cushion link, skip', p.author); ensureButtons(article); return; }

    // 投稿者: 根拠(local/dist)まで分からないとボタンを決められない
    let ha = false, src = '';
    try {
      if (white.has(p.author)) { ha = false; }
      else if (local.has(p.author)) { ha = true; src = 'local'; }
      else if (cfg.dist) { const hx = await hashOf(p.author); ha = !!hx && DIST.has(hx); if (ha) src = 'dist'; }
      // 判定に使うのは、その投稿を書いたアカウント（と、引用カードを書いたアカウント）だけ。
      // リストにあるアカウントがリポストしただけの投稿はぼかさない
      var hq = await isListed(p.quoted);
    } catch (err) { console.error('[tg] evaluate failed', err); return; }
    log({ id, author: p.author, reposter: p.reposter, quoted: p.quoted, ha, hq, src });
    // 非同期の間にリストが変わったか、ノードが再利用されていたら捨てる
    if (article.dataset.tgKey !== `${version}:${id}`) { log('stale, drop', id); return; }

    article.dataset.tgSrc = src;
    const whole = ha ? [p.author] : [];
    const target = whole.length ? article : (hq && p.quoteBox ? p.quoteBox : null);
    const handles = whole.length ? whole : (target ? [p.quoted] : []);
    if (target) {
      article.dataset.tgHandles = JSON.stringify(handles);
      if (id && revealed.has(id)) article.dataset.tgRevealed = '1';
      else if (!applyStep(target, (id && steps.get(id)?.step) || 0)) reveal(article);
    }
    ensureButtons(article);
  }

  function scan() {
    const arts = document.querySelectorAll(SEL.article);
    if (!arts.length) log('article 0 — check SEL.article');
    for (const a of arts) {
      ensureButtons(a);
      const key = `${version}:${idOf(permalinkOf(a))}`;
      if (a.dataset.tgKey === key) continue;
      a.dataset.tgKey = key;
      evaluate(a);
    }
  }
  function bump() { version++; scan(); }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  loadRemoteCache();
  scan();
  fetchRemote(false);
  // X は SPA で、タブを何日も開いたままにできる。読込時だけでなく、定期的に・タブに戻ってきたときにも期限を確かめる
  setInterval(() => fetchRemote(false), REMOTE_CHECK);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fetchRemote(false); });

  // 他のタブが保存値を変えたら、メモリを合わせて判定し直す。
  // GM_addValueChangeListener が無い環境では何もしない（その場合も edit() が書く直前に読み直すので変更は失われない）
  let refreshQueued = false;
  function onStoreChange(name, oldValue, newValue, remote) {
    if (!remote || refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      const l0 = new Set(local), w0 = new Set(white), n0 = clicksOf();
      pull();
      loadRemoteCache();
      if (clicksOf() !== n0) steps.clear();   // 段階の数が変わったら、途中まで押した記録は最初から
      for (const h of new Set([...l0, ...local, ...w0, ...white])) {
        if (l0.has(h) !== local.has(h) || w0.has(h) !== white.has(h)) forgetRevealed(h);
      }
      bump();
    }, 0);
  }
  if (typeof GM_addValueChangeListener === 'function') {
    for (const k of ['tg_local', 'tg_white', 'tg_cfg', 'tg_reported', 'tg_remote']) GM_addValueChangeListener(k, onStoreChange);
  }

  // ────────────────────────────────────────────────────────────────
  // 9. 設定パネル
  // ────────────────────────────────────────────────────────────────
  // YYYY-MM-DD HH:mm
  const fmtTime = ts => {
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function openPanel() {
    document.getElementById('tg-panel')?.remove();
    const el = document.createElement('div');
    el.id = 'tg-panel';
    el.innerHTML = `
      <b>もちもちワンクッション</b> <span style="opacity:.6">${VERSION ? 'v' + VERSION + ' · ' : ''}配布リスト ${DIST.size} 件 (${DIST_SRC}${DIST_TS ? ' · ' + fmtTime(DIST_TS) : ''})</span>
      <label><input type="checkbox" id="tg-dist"> 配布リストを使う</label>
      <label><input type="checkbox" id="tg-cushion"> fusetter / poipiku / privatter リンクがある投稿はぼかさない</label>
      <label>表示までのクリック数 <select id="tg-clicks">${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join('')}</select>
        <span style="opacity:.6">2 以上: 本文 → 画像の順。3 以上: その前にぼかしが少しずつ弱くなる</span></label>
      <label>先行版扱い（この端末のみ・1行1アカウント）</label><textarea id="tg-local"></textarea>
      <label>常に表示（この端末のみ）</label><textarea id="tg-white"></textarea>
      <div class="row">
        <button id="tg-refresh">配布リストを今すぐ更新</button>
        <button id="tg-reset-rep">報告履歴をクリア</button>
        ${SEND_MODE === 'form' ? '' : '<button id="tg-pend">保留中の報告をコピー</button>'}
      </div>
      <div class="row">
        <button id="tg-save">保存</button>
        <button id="tg-close" style="margin-left:auto">閉じる</button>
      </div>`;
    document.body.appendChild(el);
    pull();   // 他のタブの変更を反映してから表示する
    // 開いた時点の内容。保存のときは、ここから変えた分だけを最新の保存値に当てる
    const l0 = new Set(local), w0 = new Set(white), c0 = { ...cfg }, k0 = clicksOf();
    el.querySelector('#tg-dist').checked = cfg.dist;
    el.querySelector('#tg-cushion').checked = cfg.cushion;
    el.querySelector('#tg-clicks').value = String(clicksOf());
    el.querySelector('#tg-local').value = [...local].join('\n');
    el.querySelector('#tg-white').value = [...white].join('\n');
    const lines = v => v.split(/\s+/).map(s => s.replace(/^@/, '').toLowerCase()).filter(s => /^[a-z0-9_]{1,15}$/.test(s));
    const applyDiff = (set, was, now) => {
      for (const h of was) if (!now.has(h)) { set.delete(h); forgetRevealed(h); }
      for (const h of now) if (!was.has(h)) { set.add(h); forgetRevealed(h); }
    };
    el.querySelector('#tg-save').onclick = () => {
      const dist = el.querySelector('#tg-dist').checked, cushion = el.querySelector('#tg-cushion').checked;
      const clicks = Number(el.querySelector('#tg-clicks').value), n0 = clicksOf();
      const l1 = new Set(lines(el.querySelector('#tg-local').value)), w1 = new Set(lines(el.querySelector('#tg-white').value));
      edit(() => {
        if (dist !== c0.dist) cfg.dist = dist;
        if (cushion !== c0.cushion) cfg.cushion = cushion;
        if (clicks !== k0) cfg.clicks = clicks;
        applyDiff(local, l0, l1); applyDiff(white, w0, w1);
      });
      if (clicksOf() !== n0) steps.clear();   // 段階の数が変わったら、途中まで押した記録は最初から
      bump(); el.remove();
    };
    el.querySelector('#tg-refresh').onclick = () => { fetchRemote(true); el.remove(); };
    el.querySelector('#tg-reset-rep').onclick = () => {
      edit(() => { for (const k of Object.keys(reported)) delete reported[k]; });
      bump();
    };
    if (el.querySelector('#tg-pend')) el.querySelector('#tg-pend').onclick = () => {
      const pend = store.get('tg_pending', []);
      navigator.clipboard.writeText(JSON.stringify(pend, null, 2));
      alert(`${pend.length} 件をコピーしました`);
    };
    el.querySelector('#tg-close').onclick = () => el.remove();
  }
  GM_registerMenuCommand('設定を開く', openPanel);

  GM_registerMenuCommand('全データを初期化', () => {
    if (!confirm('ローカルのリスト・報告履歴をすべて削除します。よろしいですか？')) return;
    // 空の値はキーごとに型を合わせる（tg_reported を配列にすると、以後の報告履歴が保存されなくなる）
    const empty = { tg_local: '[]', tg_white: '[]', tg_pending: '[]', tg_cfg: '{}', tg_reported: '{}', tg_remote: 'null' };
    for (const [k, v] of Object.entries(empty)) GM_setValue(k, v);
    GM_setValue('tg_remote_next', 0);
    GM_setValue('tg_remote_busy', 0);
    location.reload();
  });

  // ────────────────────────────────────────────────────────────────
  // セレクタが壊れたときの確認順
  // ────────────────────────────────────────────────────────────────
  // 1. SEL.article — 投稿が一件も処理されないならここ。コンソールで
  //    document.querySelectorAll('article[data-testid="tweet"]').length を確認。
  // 2. SEL.userName — 名前ブロック内に a[href="/handle"] があるか。parts(article).author が null ならここ。
  // 3. SEL.socialContext — リポストの行。構造が変わると reposterOf の closest('a') が失敗する。
  // 4. SEL.quoteBox — 引用カードがまとめて拾えないなら role="link" が変わっている。
  // 5. SEL.actionBar — ボタンが付かないならここ。
  // 6. permalinkOf — <time> を含む a[href*="/status/"] が無いと id が null になり、セッション内の表示記憶が効かない。
  // 7. ぼかし対象(photo/video/card/tweetText)の data-testid が変わっていないか。
})();
