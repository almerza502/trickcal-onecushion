// jsdom 上でユーザースクリプトをそのまま動かすための土台。差し替えるのは GM_* だけ。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { webcrypto } = require('crypto');

const SCRIPT = process.argv[2] || path.join(__dirname, '..', 'trickcal-guard.user.js');
const code = fs.readFileSync(SCRIPT, 'utf8');
// 公開ビルドには報告の送信先が無い。試験では埋めて報告の流れも確かめる（entry.ID は試験用の値）
const FORM = { url: 'https://docs.google.com/forms/d/e/TEST/formResponse', fields: { user: 'entry.2120562442', reposter: 'entry.307293834', link: 'entry.1477113937', date: 'entry.2050821820', text: 'entry.1290347790', imgs: 'entry.1028905437', iid: 'entry.1421019080' } };
const withForm = src => src.replace("const FORM_URL = '';", `const FORM_URL = ${JSON.stringify(FORM.url)};`).replace('const FORM_FIELDS = {};', `const FORM_FIELDS = ${JSON.stringify(FORM.fields)};`);
const version = (code.match(/@version\s+(\S+)/) || [])[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// gm        : GM_getValue / GM_setValue の中身（Map）。同じ Map を渡した boot どうしは「同じ保存領域を見ている別のタブ」になる。
//             再読込を表すときは、古いほうを close() してからもう一度 boot する
// opts.post : 報告 POST への応答。'ok' | 'error' | 'timeout' | <status 番号> | 未指定（応答なし）
// opts.noInfo: GM_info を定義しない
// opts.noListener: GM_addValueChangeListener を定義しない（対応していない環境）
// opts.remote: 配布リスト GET への応答を返す関数。{ status, responseText } | 'error' | 'timeout'。未指定なら応答なし
// opts.clock : { now } を渡すとスクリプトから見える Date.now() がこの値になる
// opts.url   : 開いているページの URL。未指定なら X
// opts.lang  : ブラウザの言語（navigator.language）。未指定なら 'ja'（既存の検査は日本語の文言で書いてある）
// opts.public: true なら報告の送信先を埋めない（公開ビルドそのまま）
// opts.narrow: { matches } を渡すと matchMedia('(max-width: 500px)') の結果になる。narrow.set(v) で切り替えて change を届ける
// opts.oembed: 動画 ID を受けて oEmbed の応答を返す関数。ハンドルの文字列（'ハンドル|表示名' も可） | 'error' | 'hang'（応答なし） | <status 番号>。未指定なら通信エラー
// スクリプトの setInterval は実際には動かさず、tick() で手動で一回ぶん回す
const tabsOf = gm => (gm.__tabs ||= new Set());
async function boot(html, gm, opts = {}) {
  const tab = { listeners: [] };
  tabsOf(gm).add(tab);
  // VirtualConsole を渡して location.reload の not-implemented を黙らせる
  const dom = new JSDOM(html, { url: opts.url || 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const menu = {}, posts = [], gets = [], writes = [], intervals = [], styles = [], fetches = [];
  // ページの fetch（YouTube の oEmbed だけが使う）
  w.fetch = (url, init) => {
    const id = (decodeURIComponent(url).match(/(?:v=|shorts\/)([\w-]{11})$/) || [])[1];
    fetches.push({ url, id, init });
    const r = opts.oembed ? opts.oembed(id) : 'error';
    return new Promise((res, rej) => setTimeout(() => {
      if (r === 'hang') return;
      if (r === 'error') rej(new Error('network'));
      else if (typeof r === 'number') res({ ok: false, status: r, json: async () => ({}) });
      else { const [hd, name] = String(r).split('|'); res({ ok: true, status: 200, json: async () => ({ author_url: 'https://www.youtube.com/@' + hd, author_name: name || '' }) }); }
    }, 5));
  };
  w.setInterval = fn => intervals.push(fn);
  // 1 秒以上の setTimeout（通信の時間切れ）は実際には待たず、expire() で手動で発火させる
  const longTimers = new Map(), realSet = w.setTimeout.bind(w), realClear = w.clearTimeout.bind(w);
  let longId = 0;
  w.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? (longTimers.set(--longId, fn), longId) : realSet(fn, ms, ...a));
  w.clearTimeout = id => (id < 0 ? longTimers.delete(id) : realClear(id));
  if (opts.clock) w.Date.now = () => opts.clock.now;
  Object.defineProperty(w.navigator, 'language', { configurable: true, get: () => opts.lang || 'ja' });
  if (opts.narrow) {
    const ls = [];
    const mql = { get matches() { return !!opts.narrow.matches; }, addEventListener: (t, fn) => ls.push(fn) };
    opts.narrow.set = v => { opts.narrow.matches = v; ls.forEach(fn => fn({ matches: v })); };
    w.matchMedia = () => mql;
  }
  // jsdom の video は再生できないので、play / pause / paused を簡単なもので置き換える（呼ばれた回数は el.__plays / el.__pauses）
  Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return this.__playing !== true; } });
  w.HTMLMediaElement.prototype.play = function () { this.__plays = (this.__plays || 0) + 1; this.__playing = true; this.dispatchEvent(new w.Event('play')); return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { this.__pauses = (this.__pauses || 0) + 1; this.__playing = false; };
  // jsdom には innerText が無いので textContent で代用
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  Object.assign(w, {
    GM_getValue: (k, d) => (gm.has(k) ? gm.get(k) : d),
    GM_setValue: (k, v) => {
      const old = gm.get(k);
      gm.set(k, v);
      writes.push(k);
      if (old === v) return;
      // 変更通知: 書いたタブには remote=false、他のタブには remote=true。非同期で届く
      for (const t of tabsOf(gm)) for (const l of t.listeners) if (l.key === k) setTimeout(() => l.fn(k, old, v, t !== tab), 0);
    },
    ...(opts.noListener ? {} : { GM_addValueChangeListener: (key, fn) => tab.listeners.push({ key, fn }) }),
    GM_addStyle: css => { styles.push(css); },
    GM_registerMenuCommand: (n, f) => { menu[n] = f; },
    // 戻り値の abort() を呼ぶと onabort が届く。呼ばれたかどうかは o.aborted に残す
    GM_xmlhttpRequest: o => {
      const handle = { abort: () => { o.aborted = true; setTimeout(() => o.onabort && o.onabort(), 0); } };
      if (o.method === 'GET') {
        gets.push(o);
        const r = opts.remote && opts.remote();
        if (r) setTimeout(() => {
          if (r === 'error') o.onerror && o.onerror();
          else if (r === 'timeout') o.ontimeout && o.ontimeout();
          else o.onload && o.onload(r);
        }, 5);
        return handle;
      }
      if (o.method !== 'POST') return handle;
      posts.push(o);
      const p = opts.post;
      setTimeout(() => {
        if (p === 'ok') o.onload && o.onload({ status: 200 });
        else if (typeof p === 'number') o.onload && o.onload({ status: p });
        else if (p === 'error') o.onerror && o.onerror();
        else if (p === 'timeout') o.ontimeout && o.ontimeout();
      }, 10);
      return handle;
    },
    unsafeWindow: { crypto: webcrypto },
    TextEncoder,
    confirm: () => true,
    ...(opts.noInfo ? {} : { GM_info: { script: { version } } }),
  });
  if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.eval(opts.public ? code : withForm(code));
  await sleep(80);
  // within: 投稿を絞るセレクタ（例 '#a'）。省略するとページ全体
  const btns = within => [...w.document.querySelectorAll(`${within ? within + ' ' : ''}.tg-btn`)];
  // 折り返し位置の印（ゼロ幅スペース）は、見た目に出ないので比べるときは除く
  const label = b => b.textContent.replace(/\u200B/g, '');
  const texts = within => btns(within).map(label);
  const click = async (t, within) => {
    const b = btns(within).find(x => label(x) === t);
    if (!b) throw new Error(`button not found: ${t} / have ${JSON.stringify(texts(within))}`);
    b.click(); await sleep(80);
  };
  const close = () => { tabsOf(gm).delete(tab); };
  const tick = async () => { intervals.forEach(fn => fn()); await sleep(80); };
  const expire = async () => { const fns = [...longTimers.values()]; longTimers.clear(); fns.forEach(fn => fn()); await sleep(80); };
  return { w, menu, posts, gets, writes, styles, fetches, texts, click, close, tick, expire, pendingTimers: () => longTimers.size, sleep };
}

let fails = 0;
const check = (name, ok, extra) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))}`);
  if (!ok) fails++;
};
const done = () => { console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0); };
const main = fn => fn().then(done).catch(e => { console.error(e); process.exit(2); });

module.exports = { boot, check, main, code, version };
