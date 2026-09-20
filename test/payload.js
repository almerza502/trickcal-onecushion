// usage: node test/payload.js [userscript path]
// 報告ペイロードの中身。引用カードの内容が投稿者のものと混ざらないことを確認する。
const { boot, check, main } = require('./env');

const LINK = 'https://x.com/TG_Test_A/status/555';
const head = `<div data-testid="User-Name"><a href="/TG_Test_A"><span>Name</span></a>
  <a href="/TG_Test_A/status/555"><time datetime="2026-09-19T01:00:00.000Z">1h</time></a></div>`;
// 引用カード: 全体が role="link"、中にリンクは無く @handle のテキストだけ
const quote = inner => `<div role="link" tabindex="0">
  <div data-testid="User-Name"><span>QName</span><span>@TG_Test_Q</span><time datetime="2026-09-01T00:00:00.000Z">Sep 1</time></div>
  ${inner}</div>`;
const text = t => `<div data-testid="tweetText">${t}</div>`;
const photo = id => `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/${id}?format=jpg&name=small"></div>`;
const page = body => `<!doctype html><body><article data-testid="tweet">${head}${body}<div role="group"></div></article></body>`;
const M = id => `https://pbs.twimg.com/media/${id}?format=jpg&name=medium`;

async function run(html) {
  const s = await boot(html, new Map([['tg_local', '["tg_test_a"]']]), { post: 'ok' });
  await s.click('報告');
  const q = new URLSearchParams(s.posts[0].data);
  return {
    user: q.get('entry.2120562442'), reposter: q.get('entry.307293834'), link: q.get('entry.1477113937'),
    date: q.get('entry.2050821820'), text: q.get('entry.1290347790'), imgs: q.get('entry.1028905437').split('\n').filter(Boolean),
  };
}

main(async () => {
  let r;
  r = await run(page(text('own text') + photo('own') + quote(text('quoted text') + photo('q'))));
  check('F1 本文あり+引用: 本文の後ろに [引用 @handle]', r.text === 'own text\n[引用 @tg_test_q] quoted text', r.text);
  check('F1 画像は投稿者のものだけ', JSON.stringify(r.imgs) === JSON.stringify([M('own')]), r.imgs);
  check('F1 日付は投稿者の time', r.date === '2026-09-19T01:00:00.000Z', r.date);
  check('F1 user/link は投稿者', r.user === 'tg_test_a' && r.link === LINK && r.reposter === '', [r.user, r.link, r.reposter]);

  r = await run(page(quote(text('quoted text') + photo('q'))));
  check('F2 本文なし+引用: [引用 @handle] だけ', r.text === '[引用 @tg_test_q] quoted text', r.text);
  check('F2 引用元の画像は送らない', r.imgs.length === 0, r.imgs);
  check('F2 日付は投稿者の time', r.date === '2026-09-19T01:00:00.000Z', r.date);

  r = await run(page(`${text('plain')}${photo('a')}${photo('b')}
    <div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg"></video></div>
    <div data-testid="card.wrapper"><img src="https://pbs.twimg.com/card_img/1/c?format=jpg&name=small"></div>`));
  check('F3 引用なし: 本文そのまま', r.text === 'plain', r.text);
  check('F3 引用なし: 写真・動画 poster・カード画像すべて', JSON.stringify(r.imgs) === JSON.stringify([M('a'), M('b'),
    'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg', 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=medium']), r.imgs);

  r = await run(page(text('own') + quote(`<div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/q.jpg"></video></div>
    <div data-testid="card.wrapper"><img src="https://pbs.twimg.com/card_img/2/c?name=small"></div>`)));
  check('F4 引用元が動画・カードだけ: 本文は投稿者のみ、画像なし', r.text === 'own' && r.imgs.length === 0, [r.text, r.imgs]);

  const long = 'あ'.repeat(1200);
  r = await run(page(text(long) + quote(text('quoted text'))));
  check('F5 長文: 1000 字で切り、投稿者の本文が優先', r.text === long.slice(0, 1000), r.text.length);

  r = await run(page(text('あ'.repeat(990)) + quote(text('quoted text'))));
  check('F6 上限をまたぐ: 合計 1000 字以内', r.text.length === 1000 && r.text.includes('\n[引用 @'), r.text.slice(985));
});
