// usage: node test/entered.js [userscript path]
// 自分で開いたページ（X のプロフィール、YouTube のチャンネルのページ）では、その持ち主のものをぼかさない。
const { createHash } = require('crypto');
const { boot, check, main, code } = require('./env');

const SALT = (code.match(/const SALT = '([^']+)'/) || [])[1];
const csv = (...keys) => ({ status: 200, responseText: keys.map(k => `"${createHash('sha256').update(k + SALT).digest('hex')}"`).join('\n') });
const q = (t, sel) => t.w.document.querySelector(sel);
const blurred = (t, sel) => q(t, sel).hasAttribute('data-tg-blur');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// ページを移る（X も YouTube も URL だけが変わり、DOM の変化で走査が走る）
const go = async (t, path) => { t.w.history.pushState({}, '', path); t.w.document.body.append(t.w.document.createElement('i')); await t.sleep(250); };

// ── X
const rp = h => `<div><a href="/${h}"><span data-testid="socialContext">${h} reposted</span></a></div>`;
const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const art = (id, body) => `<article data-testid="tweet" id="${id}">${body}<div role="group"></div></article>`;
// L・M = 端末のリストにあるアカウント、D = 配布リストにあるアカウント、U = どちらにも無いアカウント
const X_HTML = `<!doctype html><body>
  ${art('byL',  head('TG_Test_L', 1) + text)}
  ${art('byM',  rp('tg_test_l') + head('tg_test_m', 2) + text)}
  ${art('byD',  head('tg_test_d', 3) + text)}
  ${art('byU',  head('tg_test_u', 4) + text)}
</body>`;
const xLocal = () => new Map([['tg_local', '["tg_test_l","tg_test_m"]']]);
const xOpts = url => ({ url, post: 'ok', remote: () => csv('tg_test_d') });

// ── YouTube
const V = { a1: 'AAAAAAAAAA1', a2: 'AAAAAAAAAA2', b1: 'BBBBBBBBBB1', d1: 'DDDDDDDDDD1' };
// チャンネルのページの格子のカード（チャンネルのリンクなし）
const grid = (id, vid) => `<ytd-rich-grid-media id="${id}"><ytd-thumbnail><a id="thumbnail" href="/watch?v=${vid}"><img></a></ytd-thumbnail>
  <h3><a id="video-title" href="/watch?v=${vid}">title</a></h3></ytd-rich-grid-media>`;
const shorts = (id, vid) => `<ytm-shorts-lockup-view-model id="${id}"><a href="/shorts/${vid}"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a>
  <h3><a href="/shorts/${vid}">title</a></h3></ytm-shorts-lockup-view-model>`;
// チャンネルのリンクがあるカード
const linked = (id, vid, handle) => `<ytd-video-renderer id="${id}"><ytd-thumbnail><a id="thumbnail" href="/watch?v=${vid}"><img></a></ytd-thumbnail>
  <h3><a id="video-title" href="/watch?v=${vid}">title</a></h3><ytd-channel-name><a href="/${handle}">name</a></ytd-channel-name></ytd-video-renderer>`;
const YT_HTML = `<!doctype html><body>
  ${grid('gA', V.a1)}
  ${shorts('shA', V.a2)}
  ${linked('lB', V.b1, '@tg_test_b')}
  ${linked('lA', V.d1, '@TG_Test_A')}
</body>`;
const OWNER = { [V.a1]: 'tg_test_a', [V.a2]: 'tg_test_a' };
const oembed = id => OWNER[id] || 404;
const ytLocal = () => new Map([['tg_local', '["yt:@tg_test_a","yt:@tg_test_b"]'], ['tg_cfg', JSON.stringify({ yt: true, clicks: 1 })]]);

main(async () => {
  // ── X: プロフィール
  let t = await boot(X_HTML, xLocal(), xOpts('https://x.com/tg_test_l'));
  check('X1 プロフィールでは、持ち主の投稿はぼかさない（URL と投稿で大文字小文字が違ってもよい）', !blurred(t, '#byL'));
  check('X2 ボタンは表示にしたときと同じ（端末のリスト: 報告・解除）', same(t.texts('#byL'), ['報告', '解除']), t.texts('#byL'));
  check('X3 持ち主がリポストした、ほかのリストのアカウントの投稿はぼかす', blurred(t, '#byM'));
  check('X4 リストに無いアカウントの投稿はそのまま', !blurred(t, '#byU') && same(t.texts('#byU'), ['先行版扱い']), t.texts('#byU'));
  t.close();

  t = await boot(X_HTML, xLocal(), xOpts('https://x.com/TG_TEST_L/media'));
  check('X5 プロフィールのタブ（/media など）でも同じ', !blurred(t, '#byL') && blurred(t, '#byM'));
  t.close();

  t = await boot(X_HTML, xLocal(), xOpts('https://x.com/tg_test_d'));
  check('X6 配布リストのアカウントのプロフィール: ぼかさず、「常に表示」が出る', !blurred(t, '#byD') && same(t.texts('#byD'), ['常に表示 @tg_test_d']), t.texts('#byD'));
  check('X7 そのページでも、ほかのアカウントは通常どおり', blurred(t, '#byL') && blurred(t, '#byM'));
  t.close();

  for (const url of ['https://x.com/home', 'https://x.com/tg_test_l/status/1', 'https://x.com/search?q=tg_test_l', 'https://x.com/tg_test_lx']) {
    t = await boot(X_HTML, xLocal(), xOpts(url));
    check(`X8 プロフィール以外ではぼかす: ${url.replace('https://x.com', '')}`, blurred(t, '#byL') && blurred(t, '#byM') && blurred(t, '#byD'));
    t.close();
  }

  // ページを移ったら判定し直す
  t = await boot(X_HTML, xLocal(), xOpts('https://x.com/tg_test_l'));
  await go(t, '/home');
  check('X9 プロフィールからホームへ移ると、ぼかす', blurred(t, '#byL'));
  await go(t, '/tg_test_l');
  check('X10 プロフィールへ戻ると、ぼかさない', !blurred(t, '#byL'));
  // プロフィールで投稿を押して開いたら、開いた先でぼかし直さない
  q(t, '#byL [data-testid="tweetText"]').click();
  await go(t, '/tg_test_l/status/1');
  check('X11 プロフィールで押して開いた投稿は、投稿のページでぼかさない', !blurred(t, '#byL') && q(t, '#byL').dataset.tgRevealed === '1');
  check('X12 押していない投稿は、投稿のページでぼかす', blurred(t, '#byM'));
  t.close();

  // ── YouTube: チャンネルのページ
  t = await boot(YT_HTML, ytLocal(), { url: 'https://www.youtube.com/@TG_Test_A/videos', oembed });
  check('Y1 チャンネルのページでは、そのチャンネルの動画はぼかさない（リンクの無いカード）', !blurred(t, '#gA') && !blurred(t, '#shA'));
  check('Y2 そのカードのために問い合わせない', t.fetches.length === 0, t.fetches.map(f => f.id));
  check('Y3 ボタンは表示にしたときと同じ（端末のリスト: 解除）', same(t.texts('#gA'), ['解除']), t.texts('#gA'));
  check('Y4 リンクがそのチャンネルのカードもぼかさない', !blurred(t, '#lA'));
  check('Y5 ほかのリストのチャンネルのカードはぼかす', blurred(t, '#lB'));
  t.close();

  t = await boot(YT_HTML, ytLocal(), { url: 'https://www.youtube.com/channel/UC0123456789abcdefghijkl/shorts', oembed });
  check('Y6 /channel/… の形でも、リンクの無いカードはぼかさず、問い合わせない', !blurred(t, '#gA') && !blurred(t, '#shA') && t.fetches.length === 0, t.fetches.map(f => f.id));
  check('Y7 その形ではチャンネルが分からないので、ボタンは出さない', same(t.texts('#gA'), []), t.texts('#gA'));
  t.close();

  t = await boot(YT_HTML, ytLocal(), { url: 'https://www.youtube.com/@%E3%83%86%E3%82%B9%E3%83%88', oembed });
  check('Y8 ほかのチャンネルのページでは、リンクのあるリストのチャンネルはぼかす', blurred(t, '#lA') && blurred(t, '#lB'));
  t.close();

  t = await boot(YT_HTML, ytLocal(), { url: 'https://www.youtube.com/results?search_query=x', oembed });
  check('Y9 チャンネルのページ以外ではぼかす（リンクの無いカードは問い合わせて決める）', blurred(t, '#gA') && blurred(t, '#shA') && blurred(t, '#lA') && t.fetches.length === 2, [t.fetches.length]);
  t.close();

  t = await boot(YT_HTML, ytLocal(), { url: 'https://www.youtube.com/@tg_test_a', oembed });
  await go(t, '/results?search_query=x');
  check('Y10 チャンネルのページから検索へ移ると、ぼかす', blurred(t, '#gA') && blurred(t, '#lA'));
  await go(t, '/@tg_test_a/videos');
  check('Y11 チャンネルのページへ戻ると、ぼかさない', !blurred(t, '#gA') && !blurred(t, '#lA'));
  q(t, '#gA h3 a').click();
  await go(t, '/results?search_query=x');
  check('Y12 チャンネルのページで押して開いた動画は、移った先でぼかさない', !blurred(t, '#gA') && q(t, '#gA').dataset.tgRevealed === '1');
  check('Y13 押していない動画は、移った先でぼかす', blurred(t, '#lA'));
  t.close();
});
