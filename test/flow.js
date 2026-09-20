// usage: node test/flow.js [userscript path]
// ボタンの流れと保存値: 先行版扱い → 報告 → 再読込、初期化、送信の成否、設定パネルの版数。
const { boot, check, main, code, version } = require('./env');

const HTML = `<!doctype html><body>
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/TG_Test_A"><span>Name</span></a>
    <a href="/TG_Test_A/status/123"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>
  <div data-testid="tweetText">hello</div>
  <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/abc?format=jpg&name=small"></div>
  <div role="group"></div>
</article></body>`;
const LINK = 'https://x.com/TG_Test_A/status/123';
// このファイルではタブは常に一つ。load し直す = 再読込
let cur = null;
const load = async (gm, opts) => { cur?.close(); return (cur = await boot(HTML, gm, opts)); };

main(async () => {
  let gm, s;
  const saved = () => { try { return !!JSON.parse(gm.get('tg_reported'))[LINK]; } catch { return false; } };

  // ── A. 通常: 先行版扱い → 報告 → 再読込で ✓
  gm = new Map();
  s = await load(gm);
  check('A1 未登録は「先行版扱い」のみ', JSON.stringify(s.texts()) === '["先行版扱い"]', s.texts());
  await s.click('先行版扱い');
  check('A2 ローカル登録後は 報告+解除', JSON.stringify(s.texts()) === '["報告","先行版扱いを解除"]', s.texts());
  check('A2 ハンドルは小文字で保存', gm.get('tg_local') === '["tg_test_a"]', gm.get('tg_local'));
  await s.click('報告');
  check('A3 POST 1 件', s.posts.length === 1);
  check('A4 tg_reported に保存', saved(), gm.get('tg_reported'));
  s = await load(gm);
  check('A5 再読込後は ✓', s.texts()[0] === '✓', s.texts());

  // ── B. 「全データを初期化」後も報告履歴が保存されるか
  s.menu['全データを初期化']();
  const types = Object.fromEntries(['tg_local', 'tg_white', 'tg_cfg', 'tg_reported', 'tg_pending', 'tg_remote'].map(k => [k, gm.get(k)]));
  check('B0 初期化後の保存値はキーごとの型', JSON.stringify(types) === '{"tg_local":"[]","tg_white":"[]","tg_cfg":"{}","tg_reported":"{}","tg_pending":"[]","tg_remote":"null"}', types);
  check('B0 iid は初期化で消えない', !!gm.get('tg_iid'));
  s = await load(gm);
  check('B1 初期化後は「先行版扱い」のみ', JSON.stringify(s.texts()) === '["先行版扱い"]', s.texts());
  await s.click('先行版扱い');
  await s.click('報告');
  check('B2 POST 1 件', s.posts.length === 1);
  check('B3 tg_reported に保存（初期化後）', saved(), gm.get('tg_reported'));
  s = await load(gm);
  check('B4 再読込後は ✓（重複送信を防げる）', s.texts()[0] === '✓', s.texts());
  s.menu['設定を開く']();
  check('B5 設定の既定値が生きている', s.w.document.querySelector('#tg-dist').checked && s.w.document.querySelector('#tg-cushion').checked, gm.get('tg_cfg'));
  check('B6 変えていないキーは書かない', !s.writes.includes('tg_cfg') && !s.writes.includes('tg_local'), s.writes);

  // ── C. tg_reported に配列が入ってしまっている端末（0.3.7 以前の初期化）
  gm = new Map([['tg_local', '["tg_test_a"]'], ['tg_reported', '[]']]);
  s = await load(gm);
  await s.click('報告');
  check('C1 壊れた保存値からでも保存できる', saved(), gm.get('tg_reported'));
  s = await load(gm);
  check('C2 再読込後は ✓', s.texts()[0] === '✓', s.texts());

  // ── D. 送信の成否
  for (const bad of ['error', 'timeout', 400, 429, 500]) {
    gm = new Map([['tg_local', '["tg_test_a"]']]);
    s = await load(gm, { post: bad });
    await s.click('報告');
    check(`D-${bad} 失敗なら「報告」に戻る`, s.texts()[0] === '報告' && !saved() && s.posts.length === 1, [s.texts(), gm.get('tg_reported')]);
    s = await load(gm, { post: 'ok' });
    await s.click('報告');
    check(`D-${bad} 再送が成功すれば ✓ が残る`, s.texts()[0] === '✓' && saved() && s.posts.length === 1, s.texts());
  }
  gm = new Map([['tg_local', '["tg_test_a"]']]);
  s = await load(gm, { post: 'ok' });
  let base = s.pendingTimers();   // 起動時のリスト取得（このファイルでは応答なし）のぶん
  await s.click('報告');
  check('D-ok 成功なら ✓ のまま・保存あり', s.texts()[0] === '✓' && saved());
  const q = new URLSearchParams(s.posts[0].data);
  check('D-ok 送信内容', q.get('entry.2120562442') === 'tg_test_a' && q.get('entry.307293834') === '' && q.get('entry.1477113937') === LINK
    && q.get('entry.2050821820') === '2026-09-19T00:00:00.000Z' && q.get('entry.1290347790') === 'hello'
    && q.get('entry.1028905437') === 'https://pbs.twimg.com/media/abc?format=jpg&name=medium' && q.get('entry.1421019080') === gm.get('tg_iid'), s.posts[0].data);
  check('D-ok timeout 指定あり', s.posts[0].timeout > 0);
  check('D-ok クッキーを付けない', s.posts[0].anonymous === true);
  check('D-ok 応答が来たら時間切れのタイマーは残らない', s.pendingTimers() === base, [base, s.pendingTimers()]);
  await s.expire();
  check('D-ok 応答のあとに時間切れが来ても ✓ のまま', s.texts()[0] === '✓' && saved());

  // 応答がまったく来ない（timeout が効かない環境）: 自前の時間切れで中断し、「報告」に戻す
  gm = new Map([['tg_local', '["tg_test_a"]']]);
  s = await load(gm);
  base = s.pendingTimers();
  await s.click('報告');
  check('D-hang 応答待ちの間は ✓', s.texts()[0] === '✓' && saved() && s.pendingTimers() === base + 1, [s.texts(), base, s.pendingTimers()]);
  await s.expire();
  check('D-hang 時間切れで中断し「報告」に戻る', s.posts[0].aborted === true && s.texts()[0] === '報告' && !saved(), [s.posts[0].aborted, s.texts(), gm.get('tg_reported')]);
  s.posts[0].onload({ status: 200 }); await s.sleep(40);
  check('D-hang 中断のあとに遅れて届いた応答は無視', s.texts()[0] === '報告' && !saved(), s.texts());

  // ── E. 設定パネルの版数
  s.menu['設定を開く']();
  let head = s.w.document.querySelector('#tg-panel span').textContent;
  check('E1 パネルに @version が出る', head.startsWith('v' + version + ' · 配布リスト'), head);
  check('E2 版数の直書きが残っていない', !/v0\.\d+\.\d+/.test(code.replace(/^\/\/ @version.*$/m, '')));
  s = await load(new Map(), { noInfo: true });
  s.menu['設定を開く']();
  head = s.w.document.querySelector('#tg-panel span').textContent;
  check('E3 GM_info が無くても落ちない', head.startsWith('配布リスト'), head);
});
