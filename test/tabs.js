// usage: node test/tabs.js [userscript path]
// タブを二つ開いているとき: 片方の変更をもう片方が消さないこと、変更がもう片方にも届くこと。
const { boot, check, main } = require('./env');

const art = (h, id) => `<article data-testid="tweet" id="${h.slice(-1)}">
  <div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
    <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>
  <div data-testid="tweetText">text</div><div role="group"></div></article>`;
const HTML = `<!doctype html><body>${art('tg_test_a', 1)}${art('tg_test_b', 2)}${art('tg_test_c', 3)}</body>`;
const LA = 'https://x.com/tg_test_a/status/1', LB = 'https://x.com/tg_test_b/status/2';

const list = (gm, k) => JSON.parse(gm.get(k) || '[]').slice().sort();
const repKeys = gm => Object.keys(JSON.parse(gm.get('tg_reported') || '{}')).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blurred = (tab, sel) => tab.w.document.querySelector(sel).hasAttribute('data-tg-blur');

main(async () => {
  // どちらのタブも、操作の前に開いておく
  for (const noListener of [true, false]) {
    const tag = noListener ? 'G(通知なし)' : 'H(通知あり)';
    const open = (gm, o = {}) => boot(HTML, gm, { post: 'ok', noListener, ...o });

    // ── 1. 追加どうし・報告どうしが互いを消さない
    let gm = new Map();
    let t1 = await open(gm), t2 = await open(gm);
    await t1.click('先行版扱い', '#a');
    check(`${tag}1 書くのは変えたキーだけ`, same(t1.writes.filter(k => /^tg_(local|white|cfg|reported)$/.test(k)), ['tg_local']), t1.writes);
    await t2.click('先行版扱い', '#b');
    check(`${tag}1 別々のタブで登録した二件が両方残る`, same(list(gm, 'tg_local'), ['tg_test_a', 'tg_test_b']), gm.get('tg_local'));
    await t1.click('報告', '#a');
    await t2.click('報告', '#b');
    check(`${tag}1 別々のタブの報告履歴が両方残る`, same(repKeys(gm), [LA, LB]), repKeys(gm));
    check(`${tag}1 登録も消えていない`, same(list(gm, 'tg_local'), ['tg_test_a', 'tg_test_b']), gm.get('tg_local'));
    t1.close(); t2.close();
    let r = await open(gm);
    check(`${tag}1 再読込後も A・B とも ✓`, r.texts('#a')[0] === '✓' && r.texts('#b')[0] === '✓' && blurred(r, '#a') && blurred(r, '#b'), [r.texts('#a'), r.texts('#b')]);
    r.close();

    // ── 2. 片方で解除したものを、もう片方の保存が復活させない
    gm = new Map([['tg_local', '["tg_test_a"]']]);
    t1 = await open(gm); t2 = await open(gm);
    await t1.click('解除', '#a');
    await t2.click('先行版扱い', '#b');
    check(`${tag}2 解除した A は戻らず、B だけ残る`, same(list(gm, 'tg_local'), ['tg_test_b']), gm.get('tg_local'));
    t1.close(); t2.close();

    // ── 3. 他のタブで報告済みの投稿は二重に送らない
    gm = new Map([['tg_local', '["tg_test_a"]']]);
    t1 = await open(gm); t2 = await open(gm);
    await t1.click('報告', '#a');
    if (noListener) {
      await t2.click('報告', '#a');     // t2 の画面はまだ「報告」のまま。押しても送らない
      check(`${tag}3 二重送信しない`, t2.posts.length === 0 && t2.texts('#a')[0] === '✓', [t2.posts.length, t2.texts('#a')]);
    } else {
      check(`${tag}3 もう片方のタブも ✓ になる`, t2.texts('#a')[0] === '✓', t2.texts('#a'));
    }
    t1.close(); t2.close();

    // ── 4. 送信失敗の巻き戻しが、他のタブの報告履歴を消さない
    gm = new Map([['tg_local', '["tg_test_a","tg_test_b"]']]);
    t1 = await open(gm, { post: 'error' }); t2 = await open(gm);
    await Promise.all([t1.click('報告', '#a'), t2.click('報告', '#b')]);
    check(`${tag}4 失敗した A だけ消え、B は残る`, same(repKeys(gm), [LB]), repKeys(gm));
    t1.close(); t2.close();

    // ── 5. 設定パネル: 開いたあとに他のタブが入れた変更を、保存で消さない
    gm = new Map([['tg_local', '["tg_test_a"]'], ['tg_white', '["tg_test_c"]']]);
    t1 = await open(gm); t2 = await open(gm);
    t1.menu['設定を開く']();
    await t2.click('先行版扱い', '#b');
    const d = t1.w.document;
    d.querySelector('#tg-local').value = '@TG_Test_D';        // A を消して D を足す
    d.querySelector('#tg-cushion').checked = false;
    d.querySelector('#tg-save').click(); await t1.sleep(80);
    check(`${tag}5 パネルの差分だけ当たる（A 削除・D 追加・B は残る）`, same(list(gm, 'tg_local'), ['tg_test_b', 'tg_test_d']), gm.get('tg_local'));
    check(`${tag}5 触っていないリストと設定はそのまま`, same(list(gm, 'tg_white'), ['tg_test_c']) && JSON.parse(gm.get('tg_cfg')).dist === true && JSON.parse(gm.get('tg_cfg')).cushion === false, [gm.get('tg_white'), gm.get('tg_cfg')]);
    t1.close(); t2.close();
  }

  // ── I. 通知ありのときだけ: 変更がもう片方の画面にもすぐ届く
  let gm = new Map();
  let t1 = await boot(HTML, gm, { post: 'ok' }), t2 = await boot(HTML, gm, { post: 'ok' });
  await t1.click('先行版扱い', '#a');
  check('I1 登録がもう片方のタブでもぼかしになる', blurred(t2, '#a') && same(t2.texts('#a'), ['報告', '解除']), [blurred(t2, '#a'), t2.texts('#a')]);
  t2.w.document.querySelector('#a [data-testid="tweetText"]').click(); await t2.sleep(40);
  check('I2 t2 で表示にする', !blurred(t2, '#a'));
  await t1.click('解除', '#a');
  check('I3 解除も届く', same(t2.texts('#a'), ['先行版扱い']), t2.texts('#a'));
  await t1.click('先行版扱い', '#a');
  check('I4 登録し直すと、表示にしていたタブでも再びぼかす', blurred(t2, '#a'), blurred(t2, '#a'));
  await t1.click('解除', '#a');
  t1.menu['設定を開く']();
  t1.w.document.querySelector('#tg-white').value = 'tg_test_c';
  t1.w.document.querySelector('#tg-save').click(); await t1.sleep(80);
  check('I5 パネルの保存も届く', same(t2.texts('#c'), ['戻す']), t2.texts('#c'));
  t1.menu['全データを初期化'](); await t1.sleep(80);
  check('I6 初期化も届く', same(t2.texts('#c'), ['先行版扱い']), t2.texts('#c'));
});
