// usage: node test/remote.js [userscript path]
// 配布リストの更新: 読込時だけでなく、開いたままのタブでも期限が切れたら取り直すこと。
const { createHash } = require('crypto');
const { boot, check, main, code } = require('./env');

const SALT = (code.match(/const SALT = '([^']+)'/) || [])[1];
const hash = h => createHash('sha256').update(h + SALT).digest('hex');
const csv = (...hs) => ({ status: 200, responseText: '"hash"\n' + hs.map(h => `"${hash(h)}"`).join('\n') });

const art = (h, id) => `<article data-testid="tweet" id="${h.slice(-1)}">
  <div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
    <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>
  <div data-testid="tweetText">text</div><div role="group"></div></article>`;
const HTML = `<!doctype html><body>${art('tg_test_a', 1)}${art('tg_test_b', 2)}</body>`;
const blurred = (tab, sel) => tab.w.document.querySelector(sel).hasAttribute('data-tg-blur');
const MIN = 60 * 1000, HOUR = 60 * MIN;
const T0 = 1_800_000_000_000;

main(async () => {
  check('SALT を読めている', !!SALT, SALT);

  // ── J. 一つのタブを開いたままにする
  let gm = new Map(), clock = { now: T0 }, res = csv('tg_test_a');
  let t = await boot(HTML, gm, { clock, remote: () => res });
  check('J1 読込時に一度取りに行き、A をぼかす', t.gets.length === 1 && blurred(t, '#a') && !blurred(t, '#b'), [t.gets.length, blurred(t, '#a'), blurred(t, '#b')]);
  check('J1 配布リストの投稿にはボタンを出さない', t.texts('#a').length === 0, t.texts('#a'));
  check('J1 クッキーを付けない', t.gets[0].anonymous === true && t.pendingTimers() === 0, [t.gets[0].anonymous, t.pendingTimers()]);
  res = csv('tg_test_a', 'tg_test_b');                 // 配布リストに B が加わった
  clock.now = T0 + 5 * HOUR; await t.tick();
  check('J2 期限内（5 時間後）は取りに行かない', t.gets.length === 1 && !blurred(t, '#b'), t.gets.length);
  clock.now = T0 + 6 * HOUR + MIN; await t.tick();
  check('J3 期限切れ（6 時間後）は再読込なしで取り直し、B もぼかす', t.gets.length === 2 && blurred(t, '#b'), [t.gets.length, blurred(t, '#b')]);
  check('J3 キャッシュの時刻も更新', JSON.parse(gm.get('tg_remote')).ts === clock.now && JSON.parse(gm.get('tg_remote')).hashes.length === 2);
  await t.tick();
  check('J4 取り直した直後は取りに行かない', t.gets.length === 2, t.gets.length);

  // ── K. 通信エラー（短く待つ）と、リストが取れない応答（長く待つ）
  const kept = () => blurred(t, '#a') && blurred(t, '#b') && JSON.parse(gm.get('tg_remote')).hashes.length === 2;
  for (const bad of ['error', 'timeout']) {
    res = bad;
    clock.now += 6 * HOUR + MIN; await t.tick();
    const n = t.gets.length;
    check(`K1-${bad} 失敗しても既存のリストは残る`, kept(), n);
    clock.now += 10 * MIN; await t.tick();
    check(`K1-${bad} 直後（10 分後）は再試行しない`, t.gets.length === n, t.gets.length);
    res = csv('tg_test_a', 'tg_test_b');
    clock.now += 21 * MIN; await t.tick();
    check(`K1-${bad} 30 分たてば再試行`, t.gets.length === n + 1, t.gets.length);
  }
  for (const [name, bad] of [['空の 200', { status: 200, responseText: '' }], ['見出しだけの 200', { status: 200, responseText: '"hash"\n' }],
    ['HTML の 200', { status: 200, responseText: '<html>sign in</html>' }], ['404', { status: 404, responseText: '' }], ['429', { status: 429, responseText: '' }]]) {
    res = bad;
    clock.now += 6 * HOUR + MIN; await t.tick();
    const n = t.gets.length;
    check(`K2-${name} 既存のリストは残る`, kept(), n);
    clock.now += 31 * MIN; await t.tick();
    clock.now += 5 * HOUR; await t.tick();
    check(`K2-${name} 30 分後も 5 時間半後も再試行しない`, t.gets.length === n, t.gets.length);
    res = csv('tg_test_a', 'tg_test_b');
    clock.now += 30 * MIN; await t.tick();
    check(`K2-${name} 6 時間たてば再試行`, t.gets.length === n + 1, t.gets.length);
  }
  res = { status: 200, responseText: '' };
  clock.now += 6 * HOUR + MIN; await t.tick();
  let n = t.gets.length;
  res = csv('tg_test_b');
  t.menu['設定を開く']();
  t.w.document.querySelector('#tg-refresh').click(); await t.sleep(80);
  check('K3 待ち時間中でも手動更新は取りに行く（A が外れ、B だけ）', t.gets.length === n + 1 && !blurred(t, '#a') && blurred(t, '#b'), [t.gets.length - n, blurred(t, '#a'), blurred(t, '#b')]);
  check('K3 外れた A には「先行版扱い」が戻る', JSON.stringify(t.texts('#a')) === '["先行版扱い"]', t.texts('#a'));
  res = csv('tg_test_a');
  clock.now += 6 * HOUR + MIN; n = t.gets.length;
  t.w.document.dispatchEvent(new t.w.Event('visibilitychange')); await t.sleep(80);
  check('K4 タブに戻ってきたときにも確かめる', t.gets.length === n + 1 && blurred(t, '#a') && !blurred(t, '#b'), [t.gets.length - n, blurred(t, '#a'), blurred(t, '#b')]);
  t.close();

  // ── L. タブが二つ: 取りに行くのは片方だけ。もう片方はその結果を使う
  for (const noListener of [true, false]) {
    const tag = noListener ? 'L(通知なし)' : 'L(通知あり)';
    gm = new Map(); clock = { now: T0 }; res = csv('tg_test_a');
    const t1 = await boot(HTML, gm, { clock, remote: () => res, noListener });
    const t2 = await boot(HTML, gm, { clock, remote: () => res, noListener });
    check(`${tag}1 二つ目のタブはキャッシュを使い、取りに行かない`, t1.gets.length === 1 && t2.gets.length === 0 && blurred(t2, '#a'), [t1.gets.length, t2.gets.length]);
    res = csv('tg_test_a', 'tg_test_b');
    clock.now = T0 + 6 * HOUR + MIN;
    await t1.tick();
    if (!noListener) check(`${tag}2 片方が取り直すと、もう片方にもすぐ届く`, blurred(t2, '#b'), blurred(t2, '#b'));
    await t2.tick();
    check(`${tag}3 もう片方は取りに行かず、新しいリストを使う`, t1.gets.length === 2 && t2.gets.length === 0 && blurred(t2, '#b'), [t1.gets.length, t2.gets.length, blurred(t2, '#b')]);
    res = { status: 200, responseText: '' };
    clock.now += 6 * HOUR + MIN;
    await t1.tick();
    clock.now += 31 * MIN;
    await t2.tick(); await t1.tick();
    check(`${tag}4 片方が空応答を受けたら、もう片方も待つ`, t1.gets.length === 3 && t2.gets.length === 0, [t1.gets.length, t2.gets.length]);
    t1.close(); t2.close();
  }

  // ── M. 「配布リストを今すぐ更新」は期限に関係なく取りに行く
  gm = new Map(); clock = { now: T0 }; res = csv('tg_test_a');
  t = await boot(HTML, gm, { clock, remote: () => res });
  res = csv('tg_test_b');
  t.menu['設定を開く']();
  t.w.document.querySelector('#tg-refresh').click(); await t.sleep(80);
  check('M1 手動更新', t.gets.length === 2 && !blurred(t, '#a') && blurred(t, '#b'), [t.gets.length, blurred(t, '#a'), blurred(t, '#b')]);
  t.close();

  // ── O. 応答がまったく来ない: 自前の時間切れで中断し、通信エラーと同じく 30 分後に再試行
  gm = new Map(); clock = { now: T0 }; res = null;
  t = await boot(HTML, gm, { clock, remote: () => res });
  await t.expire();
  check('O1 時間切れで中断', t.gets.length === 1 && t.gets[0].aborted === true, [t.gets.length, t.gets[0].aborted]);
  clock.now += 10 * MIN; await t.tick();
  check('O2 10 分後は再試行しない', t.gets.length === 1, t.gets.length);
  res = csv('tg_test_a');
  clock.now += 21 * MIN; await t.tick();
  check('O3 30 分たてば再試行し、リストが入る', t.gets.length === 2 && blurred(t, '#a'), [t.gets.length, blurred(t, '#a')]);
  t.close();

  // ── B. シートが再計算中: 行が #NAME? で返る。その応答は一部でも使わず、2 分後に取り直す
  const busyAll = { status: 200, responseText: Array(3).fill('"#NAME?"').join('\n') };
  const busyPart = { status: 200, responseText: `"${hash('tg_test_b')}"\n"#NAME?"` };
  gm = new Map(); clock = { now: T0 }; res = csv('tg_test_a', 'tg_test_b');
  t = await boot(HTML, gm, { clock, remote: () => res });
  check('B0 準備: A・B をぼかしている', blurred(t, '#a') && blurred(t, '#b'));
  res = busyPart;
  clock.now += 6 * HOUR + MIN; await t.tick();
  check('B1 一部だけ #NAME? の応答でも、リストを削らない', t.gets.length === 2 && blurred(t, '#a') && blurred(t, '#b') && JSON.parse(gm.get('tg_remote')).hashes.length === 2, [t.gets.length, blurred(t, '#a')]);
  clock.now += MIN; await t.tick();
  check('B2 1 分後はまだ取りに行かない', t.gets.length === 2, t.gets.length);
  res = csv('tg_test_b');
  clock.now += MIN + 2000; await t.expire();
  check('B3 2 分後に自分で取り直し、新しいリストが入る', t.gets.length === 3 && !blurred(t, '#a') && blurred(t, '#b'), [t.gets.length, blurred(t, '#a'), blurred(t, '#b')]);
  check('B3 連続回数は成功で 0 に戻る', gm.get('tg_remote_busy') === 0, gm.get('tg_remote_busy'));
  // ずっと #NAME? のまま（シート側が壊れている）: 3 回で打ち切って 6 時間待つ
  res = busyAll;
  clock.now += 6 * HOUR + MIN; await t.tick();
  for (let i = 0; i < 5; i++) { clock.now += 2 * MIN + 2000; await t.expire(); await t.tick(); }
  check('B4 #NAME? が続いたら 1 + 3 回で打ち切る', t.gets.length === 3 + 4 && blurred(t, '#b'), t.gets.length);
  clock.now += 5 * HOUR; await t.tick();
  check('B5 打ち切ったあとは 6 時間待つ', t.gets.length === 7, t.gets.length);
  res = csv('tg_test_b');
  clock.now += HOUR + MIN; await t.tick();
  check('B6 6 時間後に再試行して復帰', t.gets.length === 8 && gm.get('tg_remote_busy') === 0, [t.gets.length, gm.get('tg_remote_busy')]);
  t.close();

  // ── N. 最初からリストが空の配布状態: 読込のたびに取りに行かない。「全データを初期化」で待ち時間も消える
  gm = new Map(); clock = { now: T0 }; res = { status: 200, responseText: '"hash"\n' };
  t = await boot(HTML, gm, { clock, remote: () => res });
  check('N1 初回は取りに行く', t.gets.length === 1, t.gets.length);
  t.close();
  clock.now += 31 * MIN;
  t = await boot(HTML, gm, { clock, remote: () => res });
  check('N2 31 分後に読み込み直しても取りに行かない', t.gets.length === 0, t.gets.length);
  t.menu['全データを初期化'](); t.close();
  t = await boot(HTML, gm, { clock, remote: () => res });
  check('N3 初期化のあとは取りに行く', t.gets.length === 1, t.gets.length);
});
