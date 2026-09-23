// usage: node test/text.js [userscript path]
// 「本文・タイトルもぼかす」の設定: 既定は入。切なら本文は最初から表示で、画像・動画だけをぼかす。
const { boot, check, main } = require('./env');

const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const photo = '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/x?format=jpg&name=small"></div>';
const art = (id, h, n, body) => `<article data-testid="tweet" id="${id}">${head(h, n)}${body}<div role="group"><button data-testid="reply"></button></div></article>`;
const quote = inner => `<div role="link" tabindex="0" id="qbox"><div data-testid="User-Name"><span>Q</span><span>@tg_test_a</span></div>${inner}</div>`;
const HTML = `<!doctype html><body>
  ${art('both', 'tg_test_a', 1, text + photo)}
  ${art('textonly', 'tg_test_a', 2, text)}
  ${art('quoting', 'tg_test_z', 3, text + quote(text))}
</body>`;
const YT = `<!doctype html><body>
  <div id="movie_player"><video></video></div><ytd-watch-metadata><h1>title</h1></ytd-watch-metadata>
  <ytd-video-renderer id="card"><ytd-thumbnail><a href="/watch?v=BBBBBBBBBB1"><img></a></ytd-thumbnail><h3><a href="/watch?v=BBBBBBBBBB1">t</a></h3><ytd-channel-name><a href="/@tg_test_a">n</a></ytd-channel-name></ytd-video-renderer>
</body>`;
const open = (cfg, html = HTML, extra = {}) => boot(html, new Map([['tg_local', JSON.stringify(html === HTML ? ['tg_test_a'] : ['yt:@tg_test_a'])], ['tg_cfg', JSON.stringify(cfg)]]), { post: 'ok', ...extra });
const q = (t, sel) => t.w.document.querySelector(sel);
const state = (t, sel) => { const el = q(t, sel); return el.hasAttribute('data-tg-blur') ? `${el.getAttribute('data-tg-blur')}${el.hasAttribute('data-tg-text') ? '+text' : ''}/${el.getAttribute('data-tg-left') || 1}` : 'shown'; };
const press = async (t, sel, what = 'img') => {
  let reached = false; const on = () => { reached = true; };
  t.w.document.addEventListener('click', on);
  q(t, `${sel} ${what === 'img' ? '[data-testid="tweetPhoto"] img' : '[data-testid="tweetText"]'}`).click();
  t.w.document.removeEventListener('click', on);
  await t.sleep(20);
  return reached;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

main(async () => {
  // 既定（入）: これまでどおり
  let t = await open({ clicks: 2 });
  check('A1 既定は入: 本文もぼかす', state(t, '#both') === '28/2' && state(t, '#textonly') === '28/1');
  t.menu['設定を開く']();
  check('A2 パネルの切替は入', q(t, '#tg-text').checked === true);
  q(t, '#tg-text').checked = false; q(t, '#tg-save').click(); await t.sleep(120);
  check('A3 切にして保存すると、その場で本文が表示になり、本文だけの投稿はぼかさない', state(t, '#both') === '28+text/1' && state(t, '#textonly') === 'shown' && JSON.parse(t.w.GM_getValue('tg_cfg')).text === false, [state(t, '#both'), state(t, '#textonly')]);
  check('A3 本文だけの投稿は「表示した」扱いにはしない（ボタンは通常どおり）', !q(t, '#textonly').hasAttribute('data-tg-revealed') && same(t.texts('#textonly'), ['報告', '解除']), t.texts('#textonly'));
  t.close();

  // 切: 画像のある投稿の段階
  t = await open({ clicks: 2, text: false });
  const r1 = await press(t, '#both', 'text');
  check('B1 切・設定 2: 本文のクリックはそのまま X に渡り、段階は進まない', r1 === true && state(t, '#both') === '28+text/1', [r1, state(t, '#both')]);
  const r2 = await press(t, '#both', 'img');
  check('B2 切・設定 2: 画像を 1 回押すと表示', r2 === false && state(t, '#both') === 'shown', [r2, state(t, '#both')]);
  t.close();
  t = await open({ clicks: 3, text: false });
  const seq = [state(t, '#both')]; await press(t, '#both'); seq.push(state(t, '#both')); await press(t, '#both'); seq.push(state(t, '#both'));
  check('B3 切・設定 3: 弱める → 表示（本文の段階は無い）', same(seq, ['28+text/2', '10+text/1', 'shown']), seq);
  t.close();
  t = await open({ clicks: 1, text: false });
  check('B4 切・設定 1: 1 回で表示', state(t, '#both') === '28+text/1' && (await press(t, '#both'), state(t, '#both')) === 'shown');
  t.close();

  // 切: 引用カードだけの判定でも同じ
  t = await open({ clicks: 2, text: false });
  check('C1 切: 本文だけの引用カードはぼかさない', state(t, '#qbox') === 'shown' && state(t, '#quoting') === 'shown');
  t.close();

  // 切: YouTube はタイトルを残してサムネイルだけ。再生ページのタイトルもぼかさない
  t = await open({ clicks: 2, text: false }, YT, { url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1', oembed: id => 'tg_test_a' });
  check('D1 切: 動画カードはタイトルを最初から表示（サムネイルだけぼかす）', state(t, '#card') === '28+text/1', state(t, '#card'));
  check('D2 切: 再生ページのクッションはタイトルをぼかさない', q(t, '#movie_player').hasAttribute('data-tg-pl') && !q(t, '[data-tg-pltitle]'));
  t.close();
  t = await open({ clicks: 2 }, YT, { url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1', oembed: id => 'tg_test_a' });
  check('D3 入: 再生ページのタイトルもぼかす', !!q(t, '[data-tg-pltitle]') && state(t, '#card') === '28/2');
  t.close();

  // 切り替えたら途中経過は最初から。他のタブにも届く
  const gm = new Map([['tg_local', '["tg_test_a"]'], ['tg_cfg', JSON.stringify({ clicks: 3 })]]);
  const t1 = await boot(HTML, gm, {}), t2 = await boot(HTML, gm, {});
  await press(t1, '#both');
  check('E0 準備: 途中まで押した', state(t1, '#both') === '10/2');
  t1.menu['設定を開く'](); q(t1, '#tg-text').checked = false; q(t1, '#tg-save').click(); await t1.sleep(120);
  check('E1 切に変えると途中経過は最初から、他のタブにも届く', state(t1, '#both') === '28+text/2' && state(t2, '#both') === '28+text/2' && state(t2, '#textonly') === 'shown', [state(t1, '#both'), state(t2, '#both')]);
  t1.close(); t2.close();
});
