// usage: node test/match.js [userscript path]
// 何を見てぼかすか: 投稿を書いたアカウントと、引用カードを書いたアカウントだけ。リポストしたアカウントは見ない。
const { createHash } = require('crypto');
const { boot, check, main, code } = require('./env');

const SALT = (code.match(/const SALT = '([^']+)'/) || [])[1];
const csv = (...hs) => ({ status: 200, responseText: hs.map(h => `"${createHash('sha256').update(h + SALT).digest('hex')}"`).join('\n') });

const rp = h => `<div><a href="/${h}"><span data-testid="socialContext">${h} reposted</span></a></div>`;
const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const quote = h => `<div role="link" tabindex="0" class="q"><div data-testid="User-Name"><span>Q</span><span>@${h}</span></div>${text}</div>`;
const art = (id, body) => `<article data-testid="tweet" id="${id}">${body}<div role="group"></div></article>`;
// L = リストにあるアカウント、U = リストに無いアカウント
const HTML = `<!doctype html><body>
  ${art('rpByListed',  rp('tg_test_l') + head('tg_test_u', 1) + text)}
  ${art('rpOfListed',  rp('tg_test_u') + head('tg_test_l', 2) + text)}
  ${art('byListed',    head('tg_test_l', 3) + text)}
  ${art('quoteListed', head('tg_test_u', 4) + text + quote('tg_test_l'))}
  ${art('listedQuotes', head('tg_test_l', 6) + text + quote('tg_test_u'))}
  ${art('plain',       head('tg_test_u', 5) + text)}
</body>`;
const blurred = (t, sel) => t.w.document.querySelector(sel).hasAttribute('data-tg-blur');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

main(async () => {
  for (const [name, gm, opts] of [
    ['端末のリスト', new Map([['tg_local', '["tg_test_l"]']]), { post: 'ok' }],
    ['配布リスト',   new Map(), { post: 'ok', remote: () => csv('tg_test_l') }],
  ]) {
    const t = await boot(HTML, gm, opts);
    check(`${name}: リストのアカウントがリポストしただけの投稿はぼかさない`, !blurred(t, '#rpByListed'));
    check(`${name}: リストのアカウントの投稿は、誰がリポストしてもぼかす`, blurred(t, '#rpOfListed'));
    check(`${name}: リストのアカウントの投稿はぼかす`, blurred(t, '#byListed'));
    check(`${name}: リストのアカウントを引用した投稿は、引用カードだけぼかす`, !blurred(t, '#quoteListed') && blurred(t, '#quoteListed .q'));
    // リストのアカウントが誰かを引用した投稿: 投稿全体がぼかしの対象で、引用カードの本文もその中に入る
    const qText = t.w.document.querySelector('#listedQuotes .q [data-testid="tweetText"]');
    check(`${name}: リストのアカウントが引用した投稿は全体をぼかす（引用カードの中身も含む）`, blurred(t, '#listedQuotes') && !!qText.closest('[data-tg-blur]') && !blurred(t, '#listedQuotes .q'));
    check(`${name}: どちらにも関係ない投稿はそのまま`, !blurred(t, '#plain'));
    check(`${name}: リポストされただけの投稿には「先行版扱い」が出る（対象は投稿者）`, same(t.texts('#rpByListed'), ['先行版扱い']), t.texts('#rpByListed'));
    t.close();
  }

  // 報告にはリポストした人の名前も入る（判定には使わない）
  const t = await boot(HTML, new Map([['tg_local', '["tg_test_l"]']]), { post: 'ok' });
  await t.click('報告', '#rpOfListed');
  const q = new URLSearchParams(t.posts[0].data);
  check('報告: user は投稿者、reposter はリポストした人', q.get('entry.2120562442') === 'tg_test_l' && q.get('entry.307293834') === 'tg_test_u', [q.get('entry.2120562442'), q.get('entry.307293834')]);
  // リポストした人を自分でリストに入れても、その人のリポストはぼかさない
  await t.click('先行版扱い', '#plain');       // tg_test_u を端末のリストに入れる
  check('投稿者を入れると、その人の投稿はぼかす', blurred(t, '#plain') && blurred(t, '#rpByListed'));
  check('その人がリポストしただけの投稿（投稿者は別）は、投稿者で決まる', blurred(t, '#rpOfListed'));
});
