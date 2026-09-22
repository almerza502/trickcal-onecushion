// ==UserScript==
// @name         トリッカル もちもちワンクッション（ネタバレ回避）
// @name:en      Trickcal One-Cushion (spoiler blur for X and YouTube)
// @namespace    tg-guard
// @version      0.4.8
// @description  トリッカルの先行版（本国版）の内容を投稿しているアカウントの投稿をぼかし、クリックで表示するワンクッションを X に追加するネタバレ回避スクリプト。設定で YouTube のサムネイルにも使えます。判定はアカウント単位。「報告」ボタンを押したときだけ、その投稿の情報を送信します。
// @description:en For players of the global version of Trickcal: blurs posts on X and video thumbnails on YouTube from accounts that post content from the advance (Korean) version, and shows them when you click. Judged per account, not by keywords. The interface is in Japanese.
// @author       anonymous
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      docs.google.com
// @run-at       document-idle
// @noframes
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
  // 動いているサイト。X と YouTube で違うのは、DOM の読み方・ぼかす対象・ボタンの置き場所だけ
  const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? 'yt' : 'x';

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
    actionBar:     '[role="group"]',                   // 返信・RP・いいねの行。リンクカードの中などにも同じ role の要素がある
    reply:         '[data-testid="reply"]',            // 返信ボタン。これを含む role="group" が目的の行
    avatar:        '[data-testid="Tweet-User-Avatar"]',
    permalinkAnchor: 'a[href*="/status/"]',            // このうち <time> を含むものが本文のパーマリンク
    cushionLinks:  'a[href*="fusetter.com"], a[href*="poipiku.com"], a[href*="privatter.net"]',
  };
  // YouTube — カードの種類ごとに要素名が違う。DOM が変わったらここを見る
  const YT = {
    card:       'ytd-video-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-compact-video-renderer, ytd-grid-video-renderer',
    wrapper:    'ytd-rich-item-renderer',           // ホームの格子でカードを包む要素（hover はここに届くことがある）
    videoLink:  'a[href^="/watch?v="], a[href^="/shorts/"]',
    handleLink: 'a[href^="/@"]',                     // 無いカードもある（Shorts の棚・再生ページの横の一覧など）
    channelName: 'ytd-channel-name',
    noName:     'ytm-shorts-lockup-view-model',     // チャンネル名が出ないカード。ぼかしている間は、文言と一緒にチャンネル名を出す
    // 再生中の動画。player の中身をまるごとぼかし、title も一緒にぼかす
    players: {
      watch:  { player: '#movie_player',  title: 'ytd-watch-metadata h1' },
      shorts: { player: '#shorts-player', title: 'yt-shorts-video-title-view-model' },
    },
    text:       ['h3', '.metadata-snippet-container', '.metadata-snippet-container-one-line'],
    media:      ['ytd-thumbnail', 'yt-thumbnail-view-model', 'ytd-expandable-metadata-renderer'],   // 最後はチャプターの行（サムネイルと文字が出る）
  };
  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/;
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose']);

  // 要素を組み立てる。HTML 文字列は使わない（innerHTML への代入を受け付けないページでも動くように）
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'style') el.style.cssText = v; else el[k] = v; }
    for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
    return el;
  };

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
  const CFG_DEFAULT = { dist: true, cushion: true, clicks: CLICKS_DEFAULT, yt: false };
  const local = new Set();      // ユーザーが自分で追加したアカウント（小文字・平文）。YouTube のチャンネルは 'yt:@ハンドル'
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
    if (SITE === 'yt' && !cfg.yt) return;   // YouTube では、設定を入にするまで何もしない
    if (!force && !cfg.dist) return;         // 「配布リストを使う」が切なら、自動では取りに行かない（手動更新は通す）
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
  const TEXT_TARGETS = SITE === 'yt' ? YT.text : [SEL.tweetText];
  const MEDIA_TARGETS = SITE === 'yt' ? YT.media : [SEL.photo, SEL.video, SEL.card];
  const TEXT_SEL = TEXT_TARGETS.join(', ');
  const MEDIA_SEL = MEDIA_TARGETS.join(', ');
  const under = (p, sels) => sels.map(x => `${p} ${x}`).join(', ');
  const BLUR_TARGETS = [...MEDIA_TARGETS, ...TEXT_TARGETS];
  // ぼかしの上に出す文言。YouTube のカードは小さいので説明を省く
  const NOTE = SITE === 'yt' ? '' : '先行版の内容が含まれる可能性があります — ';
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
    ${under('[data-tg-blur][data-tg-text]', TEXT_TARGETS)} { filter: none; clip-path: none; user-select: auto; cursor: inherit; }
    [data-tg-blur]::after {
      content: '${NOTE}クリックで表示';
      position: absolute; left: 50%; top: 55%; transform: translate(-50%, -50%);
      background: rgba(0,0,0,.65); color: #fff; padding: 6px 12px; border-radius: 16px;
      font-size: 13px; white-space: nowrap; pointer-events: none; z-index: 3;
    }
    [data-tg-blur][data-tg-left]::after { content: '${NOTE}あと ' attr(data-tg-left) ' 回クリックで表示'; }
    [data-tg-blur][data-tg-text]::after { top: 75%; }
    .tg-btn { font-size: 11px; opacity: .4; margin-left: 10px; background: none; border: 0;
              color: inherit; cursor: pointer; font-family: inherit; padding: 0; white-space: nowrap;
              flex: 0 1 auto; min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
    .tg-btn:hover { opacity: 1; }
    /* ボタンの入れ物。普段は無いものとして扱い、ボタンが返信・いいねの行にそのまま並ぶ */
    .tg-wrap { display: contents; }
    /* 幅の狭い画面のタイムライン: 投稿の左下、アイコンの列（左 16px・幅 40px）の下に縦に並べる。
       入れ物の高さは投稿に合わせて伸び（上限あり）、二つあるときは上と下に離す。短い投稿では詰まる */
    .tg-wrap.tg-side { position: absolute; left: 16px; bottom: 4px; width: 40px; height: min(calc(100% - 58px), 76px);
      display: flex; flex-direction: column; justify-content: flex-end; align-items: center; z-index: 1; pointer-events: none; }
    .tg-side .tg-btn { pointer-events: auto; margin: 0; max-width: none; width: 100%; max-height: 48px; white-space: normal;
      word-break: keep-all; overflow-wrap: anywhere; text-align: center; line-height: 14px; padding: 3px 0; font-size: 11px; opacity: .6;
      background: var(--tg-bg, transparent); }   /* スレッドの縦線の上でも読めるよう、ページの背景色を敷く */
    .tg-side .tg-btn:first-child:not(:last-child) { margin-bottom: auto; }
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
    /* YouTube: ボタンはカードの右下に重ねて置き、カーソルを乗せたときだけ見せる（カードの高さを変えない） */
    [data-tg-card] { position: relative; }
    .tg-row { position: absolute; right: 4px; bottom: 2px; z-index: 4; display: flex; gap: 10px; padding: 2px 8px;
              border-radius: 10px; background: rgba(0,0,0,.7); opacity: 0; transition: opacity .1s; }
    [data-tg-card]:hover > .tg-row, .tg-row:focus-within { opacity: 1; }
    .tg-row .tg-btn { margin-left: 0; max-width: none; color: #fff; opacity: .85; }
    ${SITE === 'yt' ? `[data-tg-blur]::after { top: 50%; font-size: 12px; white-space: normal; width: max-content;
      max-width: calc(100% - 16px); text-align: center; box-sizing: border-box; }
    /* チャンネル名の出ないカード（Shorts）: 文言の上の行にチャンネル名を出す */
    [data-tg-blur][data-tg-name]::after { content: attr(data-tg-name) '\\A' 'クリックで表示'; white-space: pre-line; }
    [data-tg-blur][data-tg-name][data-tg-left]::after { content: attr(data-tg-name) '\\A' 'あと ' attr(data-tg-left) ' 回クリックで表示'; }
    @media (pointer: coarse) {
      [data-tg-blur][data-tg-name]::after { content: attr(data-tg-name) '\\A' 'タップで表示'; }
      [data-tg-blur][data-tg-name][data-tg-left]::after { content: attr(data-tg-name) '\\A' 'あと ' attr(data-tg-left) ' 回タップで表示'; }
    }
    /* 再生中の動画: プレーヤーの中身（動画・開始前のサムネイル・操作バー）をまるごとぼかし、文言はプレーヤー自身の ::after に出す */
    /* visibility: Shorts のプレーヤーは再生が始まるまで隠されている。始まる前に止めると隠れたままになり、文言も出ず押せもしないので、出しておく。
       overflow: ぼかしのにじみをプレーヤーの外に出さない */
    [data-tg-pl] { cursor: pointer; visibility: visible !important; overflow: hidden !important; }
    [data-tg-pl] > * { filter: blur(40px) !important; }
    [data-tg-pl]::after { content: attr(data-tg-pl-name) '\\A' 'クリックで再生'; white-space: pre-line; text-align: center;
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,.65); color: #fff;
      padding: 8px 14px; border-radius: 16px; font-size: 13px; line-height: 1.5; z-index: 100; pointer-events: none; }
    [data-tg-pl]:not([data-tg-pl="1"])::after { content: attr(data-tg-pl-name) '\\A' 'あと ' attr(data-tg-pl) ' 回クリックで再生'; }
    [data-tg-pltitle] { filter: blur(10px); user-select: none; }
    @media (pointer: coarse) {
      [data-tg-pl]::after { content: attr(data-tg-pl-name) '\\A' 'タップで再生'; }
      [data-tg-pl]:not([data-tg-pl="1"])::after { content: attr(data-tg-pl-name) '\\A' 'あと ' attr(data-tg-pl) ' 回タップで再生'; }
    }
    /* サムネイルが左にある横長のカードは、文言をサムネイルの上（左寄せ）に置く */
    ytd-video-renderer[data-tg-blur]::after, ytd-compact-video-renderer[data-tg-blur]::after,
    yt-lockup-view-model[data-tg-blur]:has(> .ytLockupViewModelHorizontal)::after { left: 8px; transform: translateY(-50%); }` : ''}
    /* タッチ端末: 押しやすい大きさにし、文言を「タップ」にする */
    @media (pointer: coarse) {
      .tg-btn { font-size: 13px; padding: 8px 2px; opacity: .55; }
      .tg-row { opacity: .9; }
      [data-tg-blur]::after { content: '${NOTE}タップで表示'; }
      [data-tg-blur][data-tg-left]::after { content: '${NOTE}あと ' attr(data-tg-left) ' 回タップで表示'; }
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
    for (const k of ['tgHandles', 'tgSrc', 'tgRevealed', 'tgName']) delete article.dataset[k];
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
  // 表示の記録に使う id。X は投稿の id、YouTube は動画 ID
  const postIdOf = el => (SITE === 'yt' ? el.dataset.tgVid || null : idOf(permalinkOf(el)));
  const refreshButtons = el => (SITE === 'yt' ? ytButtons(el) : ensureButtons(el));
  function reveal(article) {
    unblur(article);
    article.dataset.tgRevealed = '1';
    const id = postIdOf(article);
    if (id) { revealed.set(id, handlesOf(article)); steps.delete(id); }
    refreshButtons(article);
  }
  function onBlurClick(article, e) {
    const b = e.target.closest('[data-tg-blur]');
    if (!b || !article.contains(b)) return;
    // ぼかしている本文・画像・動画・カードを押したときだけ「表示」。
    // それ以外（名前・…メニュー・アクションバー・余白）は X にそのまま渡す
    const hit = e.target.closest(BLUR_TARGETS.join(', '));
    if (!hit || !b.contains(hit)) return;
    if (b.hasAttribute('data-tg-text') && hit.matches(TEXT_SEL) && !hit.closest(MEDIA_SEL)) return;   // 表示済みの本文は普通の本文として扱う
    e.preventDefault(); e.stopPropagation();
    if (SITE === 'yt') e.stopImmediatePropagation();   // YouTube 自身のクリック処理（動画への移動）を走らせない
    const id = postIdOf(article);
    const step = ((id && steps.get(id)?.step) || Number(b.dataset.tgStep) || 0) + 1;
    if (!applyStep(b, step)) { reveal(article); return; }
    b.dataset.tgStep = String(step);
    if (id) steps.set(id, { step, hs: handlesOf(article) });
  }
  function attachClick(article) {
    if (article.dataset.tgClick) return;
    article.dataset.tgClick = '1';
    article.addEventListener('click', e => onBlurClick(article, e), true);
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
    // sideText: 幅の狭い画面で投稿の左下に置くときの文字。幅 40px に収まらないので、折り返してよい位置（ゼロ幅スペース）を入れる
    add:      { text: '先行版扱い', sideText: '先行版\u200B扱い', title: 'この端末で先行版扱いにする（送信しません）',
                run: (a, p) => { edit(() => local.add(p.author)); forgetRevealed(p.author); forgetPost(p.id || idOf(p.link)); bump(); } },
    report:  { text: '報告', title: '先行版の内容として報告する',
                run: (a) => report(a) },
    reported: { text: '✓', title: '報告済み', disabled: true },
    unlocal:  { text: '解除', title: 'この端末の先行版扱いを解除する',
                run: (a, p) => { edit(() => local.delete(p.author)); forgetRevealed(p.author); bump(); } },
    restore:  { text: '戻す', title: '「常に表示」をやめて、通常の判定に戻す',
                run: (a, p) => { edit(() => white.delete(p.author)); forgetRevealed(p.author); bump(); } },
  };
  // ボタンを付ける行。リンクカードや動画の中にも role="group" があり、そちらが先に見つかるので、返信ボタンのあるものを選ぶ。
  // 返信ボタンが見つからないときは、画像・動画・カードの外にある最後のもの
  function actionBarOf(article) {
    const gs = [...article.querySelectorAll(SEL.actionBar)];
    return gs.find(g => g.querySelector(SEL.reply)) || gs.filter(g => !g.closest(MEDIA_SEL)).pop() || null;
  }
  // 幅の狭い画面（スマートフォン）のタイムラインでは、返信・いいねの行に空きが無い。
  // そのときは投稿の左下（アイコンの列の下の空いている所）に縦に並べる。絶対配置なので投稿の高さは変わらない。
  // 行の中に置いたまま位置だけ左へ出すと、途中の要素に切り取られて見えないので、投稿の要素に直接付ける。
  // 個別ページの本文の投稿（tabindex="-1"）にはアイコンの列が無く、行にも空きがあるので、行の中に置く
  const NARROW = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 500px)') : null;
  function ensureButtons(article) {
    const bar = actionBarOf(article);
    if (!bar) return;
    const p = parts(article);
    const want = desiredButtons(article, p);
    const side = !!(NARROW && NARROW.matches) && article.getAttribute('tabindex') === '0';
    const host = side ? article : bar;
    const key = (side ? 'side:' : 'bar:') + want.join(',');
    let wrap = article.querySelector('.tg-wrap');
    if (!want.length) { wrap?.remove(); return; }
    if (wrap && wrap.dataset.tgBtns === key && wrap.parentElement === host) return;
    if (!wrap) wrap = h('span', { className: 'tg-wrap' });
    if (wrap.parentElement !== host) host.appendChild(wrap);
    wrap.dataset.tgBtns = key;
    wrap.classList.toggle('tg-side', side);
    fillButtons(wrap, want, article, p);
  }
  // 画面の幅が境をまたいだら（回転・ウィンドウの大きさ変更）、置き場所を決め直す
  if (NARROW && NARROW.addEventListener) NARROW.addEventListener('change', () => { document.querySelectorAll('.tg-wrap').forEach(w => w.remove()); scan(); });
  // 表示用のハンドル。YouTube のキー 'yt:@name' は '@name' と出す
  const atName = h => '@' + h.replace(/^yt:@/, '');
  function fillButtons(bar, want, article, p) {
    bar.querySelectorAll('.tg-btn').forEach(b => b.remove());
    for (const w of want) {
      const b = document.createElement('button');
      b.className = 'tg-btn';
      let spec;
      if (w.startsWith('white:')) {
        const h = w.slice(6);
        spec = { text: `常に表示 ${atName(h)}`, title: `この端末で ${atName(h)} を常に表示する（配布リストの例外）`,
                 run: () => { edit(() => white.add(h)); bump(); } };
      } else if (w.startsWith('unlocal:')) {
        const h = w.slice(8);
        spec = { text: `解除 ${atName(h)}`, title: `この端末の ${atName(h)} の先行版扱いを解除する`,
                 run: () => { edit(() => local.delete(h)); forgetRevealed(h); bump(); } };
      } else spec = BTN[w];
      b.textContent = (bar.classList.contains('tg-side') && spec.sideText) || spec.text; b.title = spec.title || '';
      if (spec.title) b.setAttribute('aria-label', spec.title);   // 表示は短く、読み上げは title と同じ全文
      if (spec.disabled) b.disabled = true;
      else b.onclick = e => { e.stopPropagation(); e.preventDefault(); spec.run(article, p); };
      bar.appendChild(b);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 7y. YouTube — 動画のカード（検索結果・ホーム・再生ページの横の一覧・Shorts の棚）をチャンネル単位でぼかす
  // ────────────────────────────────────────────────────────────────
  // チャンネルのキーは 'yt:@' + ハンドル（小文字）。端末のリスト・常に表示・配布リストの照合は X と同じものを使う。
  // カードに /@ハンドル のリンクがあればそれを使い、無ければ動画 ID から oEmbed で引く。
  // 引いている間はぼかさない（結果がリストのチャンネルだったら、その時点でぼかす）
  const ytNorm = s => { try { return decodeURIComponent(s).normalize('NFC').toLowerCase(); } catch { return ''; } };
  function ytVideoOf(card) {
    for (const a of card.querySelectorAll(YT.videoLink)) {
      const m = a.getAttribute('href').match(/^\/(watch\?v=|shorts\/)([\w-]{11})/);
      if (m) return { id: m[2], url: 'https://www.youtube.com/' + m[1] + m[2] };
    }
    return null;
  }
  function ytHandleOf(card) {
    const a = card.querySelector(`${YT.channelName} ${YT.handleLink}`) || card.querySelector(YT.handleLink);
    return a ? ytNorm(a.getAttribute('href').slice(2).split(/[/?#]/)[0]) : '';
  }

  // 動画 ID -> ハンドル。一度引いた結果は保存して使い回す（動画の持ち主は変わらない）
  const YT_VID_MAX = 3000;     // 保存する件数の上限。超えたら古いものから捨てる
  const YT_LOOKUP_MAX = 4;     // 同時に引く数
  const ytVid = new Map(SITE === 'yt' ? Object.entries(asMap(store.get('tg_yt_vid', {}))) : []);
  // ハンドル -> チャンネルの表示名。引いたときに一緒に分かるので覚えておく（チャンネル名の出ないカードで使う）
  const YT_CH_MAX = 1000;
  const ytCh = new Map(SITE === 'yt' ? Object.entries(asMap(store.get('tg_yt_ch', {}))) : []);
  const ytInflight = new Map();
  const ytQueue = []; let ytActive = 0, ytFlushTimer = 0;
  function ytFlush() {
    ytFlushTimer = 0;
    // 他のタブが足した分を消さないよう、保存値に重ねてから書く
    const all = { ...asMap(store.get('tg_yt_vid', {})), ...Object.fromEntries(ytVid) };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - YT_VID_MAX))) delete all[k];
    store.set('tg_yt_vid', all);
    const names = { ...asMap(store.get('tg_yt_ch', {})), ...Object.fromEntries(ytCh) };
    const nk = Object.keys(names);
    for (const k of nk.slice(0, Math.max(0, nk.length - YT_CH_MAX))) delete names[k];
    store.set('tg_yt_ch', names);
  }
  const ytPump = () => { while (ytActive < YT_LOOKUP_MAX && ytQueue.length) { ytActive++; ytQueue.shift()().finally(() => { ytActive--; ytPump(); }); } };
  async function ytFetchHandle(v) {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), REQ_TIMEOUT);
    try {
      // クッキーを付けない。返ってくる author_url が https://www.youtube.com/@ハンドル
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(v.url), { credentials: 'omit', signal: ac.signal });
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      const m = String(j.author_url || '').match(/\/@([^/?#]+)/);
      const hd = m ? ytNorm(m[1]) : '';
      if (hd && j.author_name) ytCh.set(hd, String(j.author_name).slice(0, 80));
      return hd;
    } catch (err) { log('lookup failed', v.id, err); return ''; }
    finally { clearTimeout(timer); }
  }
  // 引けなかったときは ''（保存しない。そのカードはぼかさない）。同じ動画は YT_FAIL_RETRY のあいだ引き直さず、それを過ぎたら引き直す。
  // 再生ページの判定は走査のたびに引きに来るので、間隔を置かないと同じ動画に何度も問い合わせてしまう
  const YT_FAIL_RETRY = 60 * 1000;
  const ytFailed = new Map();        // 動画 ID -> 引けなかった時刻
  function ytLookup(v) {
    if (ytVid.has(v.id)) return Promise.resolve(ytVid.get(v.id));
    const failedAt = ytFailed.get(v.id);
    if (failedAt && Date.now() - failedAt < YT_FAIL_RETRY) return Promise.resolve('');
    let p = ytInflight.get(v.id);
    if (!p) {
      p = new Promise(res => {
        ytQueue.push(() => ytFetchHandle(v).then(hd => {
          ytInflight.delete(v.id);
          if (hd) { ytVid.set(v.id, hd); ytFailed.delete(v.id); if (!ytFlushTimer) ytFlushTimer = setTimeout(ytFlush, 500); }
          else ytFailed.set(v.id, Date.now());
          res(hd);
        }));
        ytPump();
      });
      ytInflight.set(v.id, p);
    }
    return p;
  }

  function ytClear(card) {
    clearMarks(card);
    for (const k of ['tgKey', 'tgVid', 'tgAuthor', 'tgCard']) delete card.dataset[k];
    [...card.children].find(c => c.classList.contains('tg-row'))?.remove();
  }
  //  チャンネルの状態      | ボタン
  //  ----------------------|------------------------------------------
  //  未登録                | 先行版扱い
  //  ローカルリスト        | 解除
  //  配布リスト            | （無し）。表示した後は「常に表示 @x」
  //  常に表示              | 戻す
  //  チャンネルが分からない | （無し）
  function ytDesired(card) {
    const k = card.dataset.tgAuthor;
    if (!k) return [];
    const src = white.has(k) ? 'white' : local.has(k) ? 'local' : (card.dataset.tgSrc || '');
    if (src === 'white') return ['restore'];
    if (src === 'local') return ['unlocal'];
    if (src === 'dist') return card.dataset.tgRevealed ? ['white:' + k] : [];
    return card.hasAttribute('data-tg-blur') ? [] : ['add'];
  }
  function ytButtons(card) {
    const want = cfg.yt ? ytDesired(card) : [];
    let row = [...card.children].find(c => c.classList.contains('tg-row'));
    if (!want.length) { row?.remove(); return; }
    const key = want.join(',');
    if (row && row.dataset.tgBtns === key) return;
    if (!row) { row = h('div', { className: 'tg-row' }); card.appendChild(row); }   // YouTube が描き直して消したら、次の走査で付け直す
    row.dataset.tgBtns = key;
    fillButtons(row, want, card, { author: card.dataset.tgAuthor, id: card.dataset.tgVid });
  }
  async function ytEvaluate(card, v, key) {
    clearMarks(card);
    card.dataset.tgCard = '1';
    card.dataset.tgVid = v.id;
    card.dataset.tgAuthor = '';
    ytButtons(card);   // 前の動画のボタンが残っていれば、チャンネルが分かるまで消しておく
    const hd = ytHandleOf(card) || await ytLookup(v);
    if (card.dataset.tgKey !== key) { log('stale, drop', v.id); return; }   // カードの要素は使い回される。待つ間に中身が変わっていたら捨てる
    if (!hd) { ytButtons(card); return; }
    const k = 'yt:@' + hd;
    let listed = false, src = '';
    try {
      if (white.has(k)) { /* 常に表示 */ }
      else if (local.has(k)) { listed = true; src = 'local'; }
      else if (cfg.dist) { const hx = await hashOf(k); listed = !!hx && DIST.has(hx); if (listed) src = 'dist'; }
    } catch (err) { console.error('[tg] evaluate failed', err); return; }
    if (card.dataset.tgKey !== key) return;
    card.dataset.tgAuthor = k;
    card.dataset.tgSrc = src;
    if (listed) {
      card.dataset.tgHandles = JSON.stringify([k]);
      if (card.matches(YT.noName)) card.dataset.tgName = ytCh.get(hd) || '@' + hd;
      if (revealed.has(v.id)) card.dataset.tgRevealed = '1';
      else if (!applyStep(card, steps.get(v.id)?.step || 0)) reveal(card);
    }
    ytButtons(card);
  }

  // 再生中の動画（再生ページ・Shorts）。自動再生や Shorts の送りでリストのチャンネルの動画が始まったら、止めてぼかす。
  // 対象: チャンネルがリストにあり、このセッションでその動画を表示にしていないとき。
  // どの動画かは URL で決める（ページを移った直後の DOM には、前の動画のチャンネルが少しの間残っている）
  let ytPl = null;          // いまクッションを掛けている動画 { id, kind, key, name, left, ver }
  let ytPlDone = '';        // 判定が済んで、掛けないと決まった動画（'版数:動画 ID'）
  let ytPlSeq = 0;
  function ytCurrent() {
    let kind = '', id = '';
    if (location.pathname === '/watch') { kind = 'watch'; id = new URLSearchParams(location.search).get('v') || ''; }
    else { const m = location.pathname.match(/^\/shorts\/([\w-]{11})/); if (m) { kind = 'shorts'; id = m[1]; } }
    return /^[\w-]{11}$/.test(id) ? { kind, id, url: 'https://www.youtube.com/' + (kind === 'watch' ? 'watch?v=' : 'shorts/') + id } : null;
  }
  // クッションの間、video を止めておく。止めたら true。
  // 始まったばかり（currentTime がほぼ 0）のところで pause() すると、Shorts は「次へ」が効かなくなり、その動画から動けなくなる
  // （再生が進み始めてから止めれば起きない）。そこで、まず音だけ消しておき、少し進んでから止める。見た目は最初からぼかしてある
  const YT_HOLD_AFTER = 0.3;         // この秒数だけ再生が進んだら止める
  const ytMuted = new WeakMap();     // 止めるまでの間だけ音を消した video -> 元の muted
  function ytUnmute(v) { if (ytMuted.has(v)) { v.muted = ytMuted.get(v); ytMuted.delete(v); } }
  function ytHold(v) {
    if (v.paused) return false;
    if (v.currentTime >= YT_HOLD_AFTER) { v.pause(); ytUnmute(v); return true; }
    if (!ytMuted.has(v)) { ytMuted.set(v, v.muted); v.muted = true; }
    return false;
  }
  const ytGuarded = new WeakSet();
  function ytGuard(v) {
    if (ytGuarded.has(v)) return;
    ytGuarded.add(v);
    // クッションの間は、ページ側やキー操作で再生が始まっても止める
    const stop = () => { if (ytPl && v.closest('[data-tg-pl]') && ytHold(v)) ytPl.guardAt = Date.now(); };
    v.addEventListener('play', stop);
    v.addEventListener('playing', stop);
    v.addEventListener('timeupdate', stop);
  }
  function ytPlayerApply() {
    const sel = YT.players[ytPl.kind];
    const player = document.querySelector(sel.player);
    if (!player) return;   // まだ出来ていない。次の走査でもう一度
    if (player.getAttribute('data-tg-pl') !== String(ytPl.left)) player.setAttribute('data-tg-pl', String(ytPl.left));
    if (player.getAttribute('data-tg-pl-name') !== ytPl.name) player.setAttribute('data-tg-pl-name', ytPl.name);
    for (const t of document.querySelectorAll(sel.title)) if (!t.hasAttribute('data-tg-pltitle')) t.setAttribute('data-tg-pltitle', '1');
    for (const v of player.querySelectorAll('video')) { ytGuard(v); ytHold(v); }
  }
  function ytPlayerClear() {
    ytPl = null;
    for (const el of document.querySelectorAll('[data-tg-pl]')) { el.removeAttribute('data-tg-pl'); el.removeAttribute('data-tg-pl-name'); }
    for (const el of document.querySelectorAll('[data-tg-pltitle]')) el.removeAttribute('data-tg-pltitle');
    for (const v of document.querySelectorAll('video')) ytUnmute(v);
  }
  function ytPlayerClick() {
    const p = ytPl;
    if (--p.left > 0) { ytPlayerApply(); return; }
    revealed.set(p.id, [p.key]);
    ytPlayerClear();
    ytPlDone = `${version}:${p.id}`;
    ytPlay(p.kind);
  }
  function ytPlay(kind) {
    const v = document.querySelector(`${YT.players[kind].player} video`);
    const r = v && v.play();
    if (r && r.catch) r.catch(() => {});
  }
  async function ytCheckPlayer() {
    const cur = cfg.yt ? ytCurrent() : null;
    if (!cur) { if (ytPl) ytPlayerClear(); return; }
    if (ytPl && ytPl.id === cur.id && ytPl.ver === version) { ytPlayerApply(); return; }   // 掛けたまま。要素が作り直されていたら付け直す
    if (ytPl) {
      // 別の動画に移った・リストが変わった。前のクッションは先に外す。
      // 次の動画は、URL が変わるより先に（同じ video 要素で）再生が始まることがある。そのとき止めたのは移った先の動画の再生なので、戻す
      const resume = ytPl.id !== cur.id && ytPl.guardAt && Date.now() - ytPl.guardAt < 3000 ? ytPl.kind : '';
      ytPlayerClear();
      if (resume) ytPlay(resume);
    }
    if (ytPlDone === `${version}:${cur.id}`) return;
    const seq = ++ytPlSeq, ver = version;
    let listed = false, hd = '';
    if (!revealed.has(cur.id)) {
      hd = await ytLookup(cur);
      try { listed = !!hd && await isListed('yt:@' + hd); } catch (err) { console.error('[tg] evaluate failed', err); }
    }
    const now = ytCurrent();
    if (seq !== ytPlSeq || ver !== version || !now || now.id !== cur.id) return;   // 待つ間に別の動画へ移った・リストが変わった
    if (!listed || revealed.has(cur.id)) { if (hd || revealed.has(cur.id)) ytPlDone = `${version}:${cur.id}`; return; }
    ytPl = { id: cur.id, kind: cur.kind, key: 'yt:@' + hd, name: ytCh.get(hd) || '@' + hd, left: clicksOf(), ver };
    ytPlayerApply();
  }
  function ytScan() {
    ytCheckPlayer();
    for (const card of document.querySelectorAll(YT.card)) {
      const v = cfg.yt ? ytVideoOf(card) : null;
      if (!v) { if (card.dataset.tgKey) ytClear(card); continue; }
      ytButtons(card);
      const key = `${version}:${v.id}`;
      if (card.dataset.tgKey === key) continue;
      card.dataset.tgKey = key;
      ytEvaluate(card, v, key);
    }
  }
  if (SITE === 'yt') {
    // YouTube のクリック処理より先に受けるため、window の capture で取る（document に付けると動画へ移動してしまう）
    window.addEventListener('click', e => {
      if (ytPl && e.target.closest?.('[data-tg-pl]')) { e.preventDefault(); e.stopImmediatePropagation(); ytPlayerClick(); return; }
      const card = e.target.closest?.(YT.card);
      if (card) onBlurClick(card, e);
    }, true);
    // クッションの間は、プレーヤーの上での押下・ダブルクリック（再生の切り替え・全画面）をページに渡さない
    const onPress = e => { if (ytPl && e.target.closest?.('[data-tg-pl]')) e.stopImmediatePropagation(); };
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart', 'touchend']) window.addEventListener(type, onPress, true);
    // ぼかしている間は、カーソルを乗せたときの自動再生プレビューを始めさせない。
    // プレビューはサムネイルではなくカード全体への hover で始まるので、ぼかしのあるカードは丸ごと止める
    const onHover = e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const card = t.closest(YT.card);
      if (card ? card.hasAttribute('data-tg-blur') : (t.matches(YT.wrapper) && t.querySelector('[data-tg-blur]'))) e.stopImmediatePropagation();
    };
    for (const type of ['mouseenter', 'mouseover', 'pointerenter', 'pointerover', 'mousemove', 'pointermove']) window.addEventListener(type, onHover, true);
    document.addEventListener('yt-navigate-finish', () => scan());
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
    if (SITE === 'yt') { ytScan(); return; }
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
  // 左下のボタンの下に敷く色。X のテーマ（白・薄暗い・黒）で変わるので、リストを判定し直すたびに読み直す
  const syncTheme = () => { if (SITE === 'x' && document.body) document.documentElement.style.setProperty('--tg-bg', getComputedStyle(document.body).backgroundColor); };
  function bump() { version++; syncTheme(); scan(); }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; scan(); };
    if (SITE === 'yt') setTimeout(run, 150); else requestAnimationFrame(run);   // YouTube は書き換えが多いので間隔を空ける
    // YouTube はカードの要素を使い回し、リンク先だけを書き換えることがあるので href の変化も見る
  }).observe(document.body, SITE === 'yt' ? { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] } : { childList: true, subtree: true });
  loadRemoteCache();
  syncTheme();
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
      fetchRemote(false);
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
    const dim = text => h('span', { style: 'opacity:.6' }, text);
    const el = h('div', { id: 'tg-panel' },
      h('b', null, 'もちもちワンクッション'), ' ',
      dim(`${VERSION ? 'v' + VERSION + ' · ' : ''}配布リスト ${DIST.size} 件 (${DIST_SRC}${DIST_TS ? ' · ' + fmtTime(DIST_TS) : ''})`),
      h('label', null, h('input', { type: 'checkbox', id: 'tg-dist' }), ' 配布リストを使う'),
      h('label', null, h('input', { type: 'checkbox', id: 'tg-cushion' }), ' fusetter / poipiku / privatter リンクがある投稿はぼかさない'),
      h('label', null, h('input', { type: 'checkbox', id: 'tg-yt' }), ' YouTube でも使う（動画のサムネイルとタイトルをぼかす）'),
      h('label', null, '表示までのクリック数 ',
        h('select', { id: 'tg-clicks' }, ...[1, 2, 3, 4, 5].map(n => h('option', null, String(n)))), ' ',
        dim('2 以上: 本文 → 画像の順。3 以上: その前にぼかしが少しずつ弱くなる')),
      h('label', null, '先行版扱い（この端末のみ・1行1アカウント） ', dim('YouTube は yt:@ハンドル')), h('textarea', { id: 'tg-local' }),
      h('label', null, '常に表示（この端末のみ）'), h('textarea', { id: 'tg-white' }),
      h('div', { className: 'row' },
        h('button', { id: 'tg-refresh' }, '配布リストを今すぐ更新'),
        h('button', { id: 'tg-reset-rep' }, '報告履歴をクリア'),
        SEND_MODE !== 'form' && h('button', { id: 'tg-pend' }, '保留中の報告をコピー')),
      h('div', { className: 'row' },
        h('button', { id: 'tg-save' }, '保存'),
        h('button', { id: 'tg-close', style: 'margin-left:auto' }, '閉じる')));
    document.body.appendChild(el);
    pull();   // 他のタブの変更を反映してから表示する
    // 開いた時点の内容。保存のときは、ここから変えた分だけを最新の保存値に当てる
    const l0 = new Set(local), w0 = new Set(white), c0 = { ...cfg }, k0 = clicksOf();
    el.querySelector('#tg-dist').checked = cfg.dist;
    el.querySelector('#tg-cushion').checked = cfg.cushion;
    el.querySelector('#tg-yt').checked = !!cfg.yt;
    el.querySelector('#tg-clicks').value = String(clicksOf());
    el.querySelector('#tg-local').value = [...local].join('\n');
    el.querySelector('#tg-white').value = [...white].join('\n');
    // X のハンドルか、YouTube のキー（yt:@ハンドル）
    const lines = v => v.split(/\s+/).map(s => s.replace(/^@/, '').normalize('NFC').toLowerCase()).filter(s => /^[a-z0-9_]{1,15}$/.test(s) || /^yt:@[^\s/?#@]{1,80}$/.test(s));
    const applyDiff = (set, was, now) => {
      for (const h of was) if (!now.has(h)) { set.delete(h); forgetRevealed(h); }
      for (const h of now) if (!was.has(h)) { set.add(h); forgetRevealed(h); }
    };
    el.querySelector('#tg-save').onclick = () => {
      const dist = el.querySelector('#tg-dist').checked, cushion = el.querySelector('#tg-cushion').checked, yt = el.querySelector('#tg-yt').checked;
      const clicks = Number(el.querySelector('#tg-clicks').value), n0 = clicksOf();
      const l1 = new Set(lines(el.querySelector('#tg-local').value)), w1 = new Set(lines(el.querySelector('#tg-white').value));
      edit(() => {
        if (dist !== c0.dist) cfg.dist = dist;
        if (cushion !== c0.cushion) cfg.cushion = cushion;
        if (yt !== !!c0.yt) cfg.yt = yt;
        if (clicks !== k0) cfg.clicks = clicks;
        applyDiff(local, l0, l1); applyDiff(white, w0, w1);
      });
      if (clicksOf() !== n0) steps.clear();   // 段階の数が変わったら、途中まで押した記録は最初から
      bump(); el.remove();
      fetchRemote(false);   // YouTube を入にした直後など。期限内なら何もしない
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
    if (!confirm('ローカルのリスト・報告履歴・端末 ID をすべて削除します。よろしいですか？')) return;
    // 空の値はキーごとに型を合わせる（tg_reported を配列にすると、以後の報告履歴が保存されなくなる）
    const empty = { tg_local: '[]', tg_white: '[]', tg_pending: '[]', tg_cfg: '{}', tg_reported: '{}', tg_remote: 'null', tg_yt_vid: '{}', tg_yt_ch: '{}', tg_iid: '' };   // 端末 ID は再読込で作り直される
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
  // 5. SEL.actionBar / SEL.reply — ボタンが付かないならここ。
  // 6. permalinkOf — <time> を含む a[href*="/status/"] が無いと id が null になり、セッション内の表示記憶が効かない。
  // 7. ぼかし対象(photo/video/card/tweetText)の data-testid が変わっていないか。
})();
