// usage: node test/sites.js [userscript path]
// 「X で使う」の設定（既定は入）: 切ると X では判定も通信もボタンも無し。設定パネルは開ける。YouTube には影響しない。
const { boot, check, main } = require('./env');

const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const bar = '<div role="group"><button data-testid="reply"></button></div>';
const HTML = `<!doctype html><body>
  <article data-testid="tweet" tabindex="0" id="a">${head('tg_test_a', 1)}${text}${bar}</article>
  <article data-testid="tweet" tabindex="0" id="u">${head('tg_test_u', 2)}${text}${bar}</article>
</body>`;
const YT = `<!doctype html><body><ytd-video-renderer id="card"><ytd-thumbnail><a href="/watch?v=BBBBBBBBBB1"><img></a></ytd-thumbnail><h3><a href="/watch?v=BBBBBBBBBB1">t</a></h3><ytd-channel-name><a href="/@tg_test_a">n</a></ytd-channel-name></ytd-video-renderer></body>`;
const q = (t, sel) => t.w.document.querySelector(sel);
const blurred = (t, sel) => q(t, sel).hasAttribute('data-tg-blur');

main(async () => {
  let t = await boot(HTML, new Map([['tg_local', '["tg_test_a"]']]), { post: 'ok' });
  check('X1 既定は入: ぼかしとボタンが出て、配布リストも取りに行く', blurred(t, '#a') && t.texts('#u').length === 1 && t.gets.length === 1, [blurred(t, '#a'), t.texts('#u'), t.gets.length]);
  t.menu['設定を開く']();
  check('X2 パネルに切替がある（既定は入）', q(t, '#tg-x') && q(t, '#tg-x').checked === true);
  q(t, '#tg-x').checked = false; q(t, '#tg-save').click(); await t.sleep(120);
  check('X3 切にして保存すると、その場でぼかしもボタンも消える', !q(t, '[data-tg-blur]') && t.texts().length === 0 && !q(t, '.tg-wrap') && JSON.parse(t.w.GM_getValue('tg_cfg')).x === false, [t.texts(), t.w.GM_getValue('tg_cfg')]);
  // 新しい投稿が来ても触らない
  t.w.document.body.insertAdjacentHTML('beforeend', `<article data-testid="tweet" tabindex="0" id="n">${head('tg_test_a', 3)}${text}${bar}</article>`); await t.sleep(120);
  check('X4 切のあいだは新しい投稿にも触らない', !blurred(t, '#n') && t.texts('#n').length === 0 && !q(t, '#n').dataset.tgKey);
  t.menu['設定を開く']();
  q(t, '#tg-x').checked = true; q(t, '#tg-save').click(); await t.sleep(120);
  check('X5 入に戻すと判定し直す', blurred(t, '#a') && blurred(t, '#n') && t.texts('#u').length === 1, [blurred(t, '#a'), blurred(t, '#n')]);
  t.close();

  // 切で読み込んだとき: 通信もしない。パネルは開ける
  t = await boot(HTML, new Map([['tg_local', '["tg_test_a"]'], ['tg_cfg', JSON.stringify({ x: false })]]), { post: 'ok' });
  check('X6 切で読み込むと、ぼかし・ボタン・配布リストの取得が無い', !q(t, '[data-tg-blur]') && t.texts().length === 0 && t.gets.length === 0, [t.texts(), t.gets.length]);
  t.menu['設定を開く']();
  check('X7 パネルは開ける', !!q(t, '#tg-panel') && q(t, '#tg-x').checked === false);
  t.close();

  // YouTube は X の設定に影響されない
  t = await boot(YT, new Map([['tg_local', '["yt:@tg_test_a"]'], ['tg_cfg', JSON.stringify({ x: false })]]), { url: 'https://www.youtube.com/results?search_query=x', oembed: () => 404 });
  check('Y1 X を切にしても YouTube は動く', blurred(t, '#card') && t.gets.length === 1, [blurred(t, '#card'), t.gets.length]);
  t.close();
  t = await boot(HTML, new Map([['tg_local', '["tg_test_a"]'], ['tg_cfg', JSON.stringify({ yt: false })]]), { post: 'ok' });
  check('Y2 YouTube を切にしても X は動く', blurred(t, '#a') && t.gets.length === 1);
  t.close();
});
