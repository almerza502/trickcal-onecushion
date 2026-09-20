// usage: node test/reveal.js [userscript path]
// 表示までのクリック数（設定 1〜5）: 段階ごとの見た目、押した回数、途中経過の保持。
const { boot, check, main } = require('./env');

const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const photo = '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/x?format=jpg&name=small"></div>';
const art = (id, h, n, body) => `<article data-testid="tweet" id="${id}">${head(h, n)}${body}<div role="group"></div></article>`;
const quote = inner => `<div role="link" tabindex="0" id="qbox"><div data-testid="User-Name"><span>Q</span><span>@tg_test_a</span></div>${inner}</div>`;
const HTML = `<!doctype html><body>
  ${art('both', 'tg_test_a', 1, text + photo)}
  ${art('textonly', 'tg_test_a', 2, text)}
  ${art('imgonly', 'tg_test_a', 3, photo)}
  ${art('quoting', 'tg_test_z', 4, text + quote(text + photo))}
  ${art('other', 'tg_test_b', 5, text)}
</body>`;

const open = (clicks, extra = {}) => boot(HTML, new Map([['tg_local', '["tg_test_a"]'], ['tg_cfg', JSON.stringify({ clicks, ...extra })]]), { post: 'ok' });
const state = (t, sel) => {
  const el = t.w.document.querySelector(sel);
  return el.hasAttribute('data-tg-blur') ? `${el.getAttribute('data-tg-blur')}${el.hasAttribute('data-tg-text') ? '+text' : ''}/${el.getAttribute('data-tg-left') || 1}` : 'shown';
};
// 投稿の中の本文か画像を押す。X まで届いたか（横取りされなかったか）を返す
const press = async (t, sel, what = 'img') => {
  let reached = false;
  const onDoc = () => { reached = true; };
  t.w.document.addEventListener('click', onDoc);
  t.w.document.querySelector(`${sel} ${what === 'img' ? '[data-testid="tweetPhoto"] img' : '[data-testid="tweetText"]'}`).click();
  t.w.document.removeEventListener('click', onDoc);
  await t.sleep(20);
  return reached;
};
const seq = async (t, sel, times, what) => { const out = [state(t, sel)]; for (let i = 0; i < times; i++) { await press(t, sel, what); out.push(state(t, sel)); } return out; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

main(async () => {
  let t = await open(1);
  const css = t.styles.join('\n');
  check('Q0 ぼかしは 28px。弱い段階の規則もある', /filter: blur\(28px\)/.test(css) && ['22', '19', '16', '10'].every(v => css.includes(`[data-tg-blur="${v}"]`)) && !/blur\(14px\)/.test(css));

  // 本文+画像の投稿: 設定ごとの段階
  const want = {
    1: ['28/1', 'shown'],
    2: ['28/2', '28+text/1', 'shown'],
    3: ['28/3', '10/2', '10+text/1', 'shown'],
    4: ['28/4', '19/3', '10/2', '10+text/1', 'shown'],
    5: ['28/5', '22/4', '16/3', '10/2', '10+text/1', 'shown'],
  };
  for (const n of [1, 2, 3, 4, 5]) {
    t = await open(n);
    const got = await seq(t, '#both', n);
    check(`Q${n} クリック数 ${n}: ${want[n].join(' → ')}`, same(got, want[n]), got);
    t.close();
  }

  // 本文だけ: 本文の表示で終わり（画像の段階は無い）
  t = await open(2);
  check('R1 本文だけ・設定 2: 1 回で表示', same(await seq(t, '#textonly', 1, 'text'), ['28/1', 'shown']));
  t.close();
  t = await open(4);
  check('R2 本文だけ・設定 4: 3 回で表示', same(await seq(t, '#textonly', 3, 'text'), ['28/3', '19/2', '10/1', 'shown']));
  t.close();
  // 画像だけ: 本文の段階も 1 回と数える（1 回の押し間違いで画像が出ないように）
  t = await open(2);
  check('R3 画像だけ・設定 2: 2 回で表示', same(await seq(t, '#imgonly', 2), ['28/2', '28+text/1', 'shown']));
  t.close();

  // 本文を表示した段階では、本文のクリックは X にそのまま渡し、画像のクリックだけ数える
  t = await open(2);
  await press(t, '#both', 'text');
  check('S1 1 回目は横取りして本文を表示', state(t, '#both') === '28+text/1');
  const reached = await press(t, '#both', 'text');
  check('S2 表示済みの本文を押しても段階は進まず、X に届く', reached === true && state(t, '#both') === '28+text/1', [reached, state(t, '#both')]);
  const reached2 = await press(t, '#both', 'img');
  check('S3 画像を押すと表示。X には届かない', reached2 === false && state(t, '#both') === 'shown', [reached2, state(t, '#both')]);
  check('S4 表示後のボタン', same(t.texts('#both'), ['報告', '解除']), t.texts('#both'));
  const un = [...t.w.document.querySelectorAll('#both .tg-btn')].find(b => b.textContent === '解除');
  check('S5 短いラベルの全文は title と aria-label に入る', un.title === 'この端末の先行版扱いを解除する' && un.getAttribute('aria-label') === un.title, [un.title, un.getAttribute('aria-label')]);
  t.close();

  // 引用カードだけをぼかす場合も同じ段階
  t = await open(3);
  check('T1 引用カードだけぼかす', state(t, '#quoting') === 'shown' && state(t, '#qbox') === '28/3', [state(t, '#quoting'), state(t, '#qbox')]);
  const out = [];
  for (let i = 0; i < 3; i++) { t.w.document.querySelector('#qbox [data-testid="tweetPhoto"] img').click(); await t.sleep(20); out.push(state(t, '#qbox')); }
  check('T2 引用カード・設定 3: 10 → 本文 → 表示', same(out, ['10/2', '10+text/1', 'shown']), out);
  check('T3 表示後は「解除」ボタン', same(t.texts('#quoting'), ['解除 @tg_test_a']), t.texts('#quoting'));
  check('T4 ハンドル付きのボタンは title にもハンドルが入る', t.w.document.querySelector('#quoting .tg-btn').title === 'この端末の @tg_test_a の先行版扱いを解除する', t.w.document.querySelector('#quoting .tg-btn').title);
  t.close();

  // 途中経過は、全件の判定し直し（bump）をまたいで残る。表示済みも残る
  t = await open(3);
  await press(t, '#both'); await press(t, '#textonly', 'text'); await press(t, '#textonly', 'text');
  check('U0 準備', state(t, '#both') === '10/2' && state(t, '#textonly') === 'shown', [state(t, '#both'), state(t, '#textonly')]);
  await t.click('先行版扱い', '#other');    // 別の投稿の操作で全件を判定し直す
  check('U1 判定し直しても途中経過・表示済みが残る', state(t, '#both') === '10/2' && state(t, '#textonly') === 'shown' && state(t, '#other') === '28/2', [state(t, '#both'), state(t, '#textonly'), state(t, '#other')]);
  // そのアカウントを外して入れ直したら最初から
  await t.click('解除', '#both'); await t.click('先行版扱い', '#both');
  check('U2 登録し直すと最初から', state(t, '#both') === '28/3' && state(t, '#textonly') === '28/2', [state(t, '#both'), state(t, '#textonly')]);

  // 設定パネル
  await press(t, '#both');
  t.menu['設定を開く']();
  const sel = t.w.document.querySelector('#tg-clicks');
  check('V1 パネルに現在の値', sel.value === '3' && sel.options.length === 5, [sel.value, sel.options.length]);
  sel.value = '5';
  t.w.document.querySelector('#tg-save').click(); await t.sleep(80);
  check('V2 保存すると設定が変わり、途中経過は最初から', state(t, '#both') === '28/5', state(t, '#both'));
  t.close();
  t = await boot(HTML, new Map([['tg_local', '["tg_test_a"]']]), {});
  t.menu['設定を開く']();
  check('V3 既定値は 2', t.w.document.querySelector('#tg-clicks').value === '2' && state(t, '#both') === '28/2', [t.w.document.querySelector('#tg-clicks').value, state(t, '#both')]);
  t.close();
  for (const bad of [0, 6, 99, -1, 2.6, 'abc', null]) {
    t = await open(bad);
    const n = { 2.6: 3 }[bad] || 2;   // 範囲外・数でない値は既定値
    check(`V4 保存値が ${JSON.stringify(bad)} → ${n} として扱う`, state(t, '#both') === `28/${n}`, state(t, '#both'));
    t.close();
  }

  // パネルの見出しとボタン
  t = await boot(HTML, new Map([['tg_remote', JSON.stringify({ ts: new Date(2026, 8, 20, 0, 46, 56).getTime(), hashes: ['0'.repeat(63) + 'a'] })]]), {});
  t.menu['設定を開く']();
  const headTxt = t.w.document.querySelector('#tg-panel span').textContent;
  check('X1 日時は YYYY-MM-DD HH:mm', headTxt.includes('(cache · 2026-09-20 00:46)'), headTxt);
  const rows = [...t.w.document.querySelectorAll('#tg-panel .row')].map(r => [...r.querySelectorAll('button')].map(b => b.id));
  check('X2 ボタンは二段。送信するモードでは保留分のコピーを出さない', same(rows, [['tg-refresh', 'tg-reset-rep'], ['tg-save', 'tg-close']]), rows);
  t.w.document.querySelector('#tg-close').click();
  check('X3 閉じる', !t.w.document.querySelector('#tg-panel'));
  t.close();

  // 他のタブで設定を変えたら、こちらにも届く
  const gm = new Map([['tg_local', '["tg_test_a"]']]);
  const t1 = await boot(HTML, gm, {}), t2 = await boot(HTML, gm, {});
  t1.menu['設定を開く']();
  t1.w.document.querySelector('#tg-clicks').value = '4';
  t1.w.document.querySelector('#tg-save').click(); await t1.sleep(80);
  check('W1 他のタブの設定変更が届く', state(t2, '#both') === '28/4' && JSON.parse(gm.get('tg_cfg')).clicks === 4, [state(t2, '#both'), gm.get('tg_cfg')]);
});
