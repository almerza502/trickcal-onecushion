// usage: node test/narrow.js [userscript path]
// 幅の狭い画面: タイムラインの投稿ではボタンを投稿の左下に置く。個別ページの本文の投稿と、幅の広い画面では返信・いいねの行の中。
const { boot, check, main } = require('./env');

const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const bar = '<div role="group" class="bar"><button data-testid="reply"></button></div>';
const HTML = `<!doctype html><body style="background-color: rgb(21, 32, 43)">
  <article data-testid="tweet" tabindex="0" id="tl">${head('tg_test_u', 1)}${text}${bar}</article>
  <article data-testid="tweet" tabindex="0" id="tlListed">${head('tg_test_a', 2)}${text}${bar}</article>
  <article data-testid="tweet" tabindex="-1" id="focal">${head('tg_test_u', 3)}${text}${bar}</article>
</body>`;
const gm = () => new Map([['tg_local', '["tg_test_a"]'], ['tg_cfg', JSON.stringify({ clicks: 1 })]]);
const q = (t, sel) => t.w.document.querySelector(sel);
const where = (t, id) => { const w = q(t, `#${id} .tg-wrap`); return !w ? 'none' : `${w.parentElement.id || w.parentElement.className}${w.classList.contains('tg-side') ? '+side' : ''}`; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

main(async () => {
  // 幅の広い画面（既定）
  let t = await boot(HTML, gm(), { post: 'ok' });
  check('N1 幅の広い画面: どの投稿でも、返信・いいねの行の中', same([where(t, 'tl'), where(t, 'tlListed'), where(t, 'focal')], ['bar', 'bar', 'bar']), [where(t, 'tl'), where(t, 'tlListed'), where(t, 'focal')]);
  const css = t.styles.join('\n');
  check('N2 入れ物は普段は無いものとして扱う。左下に置くときの規則がある', css.includes('.tg-wrap { display: contents; }') && /\.tg-wrap\.tg-side \{ position: absolute; left: 16px;/.test(css));
  t.close();

  // 幅の狭い画面
  const narrow = { matches: true };
  t = await boot(HTML, gm(), { post: 'ok', narrow });
  check('N3 幅の狭い画面: タイムラインの投稿は投稿の左下、個別ページの本文の投稿は行の中', same([where(t, 'tl'), where(t, 'tlListed'), where(t, 'focal')], ['tl+side', 'tlListed+side', 'bar']), [where(t, 'tl'), where(t, 'tlListed'), where(t, 'focal')]);
  check('N4 ボタンの中身は同じ', same(t.texts('#tl'), ['先行版扱い']) && same(t.texts('#tlListed'), ['報告', '解除']) && same(t.texts('#focal'), ['先行版扱い']), [t.texts('#tl'), t.texts('#tlListed')]);
  check('N4a 左下の「先行版扱い」には折り返してよい位置が入る（行の中のものには入らない）', q(t, '#tl .tg-btn').textContent === '先行版\u200B扱い' && q(t, '#focal .tg-btn').textContent === '先行版扱い', [q(t, '#tl .tg-btn').textContent.length, q(t, '#focal .tg-btn').textContent.length]);
  check('N5 ページの背景色を読んで、ボタンの下に敷く色にする', t.w.document.documentElement.style.getPropertyValue('--tg-bg') === 'rgb(21, 32, 43)', t.w.document.documentElement.style.getPropertyValue('--tg-bg'));
  // 左下のボタンも同じように働く
  await t.click('先行版扱い', '#tl');
  check('N6 左下の「先行版扱い」で登録され、ボタンが「報告」「解除」に変わる（置き場所はそのまま）', q(t, '#tl').hasAttribute('data-tg-blur') && same(t.texts('#tl'), ['報告', '解除']) && where(t, 'tl') === 'tl+side' && t.w.document.querySelectorAll('#tl .tg-wrap').length === 1, [t.texts('#tl'), where(t, 'tl')]);
  await t.click('報告', '#tl');
  check('N7 左下の「報告」で送信される', t.posts.length === 1 && same(t.texts('#tl'), ['✓', '解除']), [t.posts.length, t.texts('#tl')]);
  // ぼかしのクリックは従来どおり
  q(t, '#tlListed [data-testid="tweetText"]').click(); await t.sleep(30);
  check('N8 ぼかしを押して表示にしても、ボタンは左下に残る', !q(t, '#tlListed').hasAttribute('data-tg-blur') && where(t, 'tlListed') === 'tlListed+side');
  // 幅が変わったら置き直す
  narrow.set(false); await t.sleep(60);
  check('N9 画面が広くなったら行の中へ移す（二重にならない）', same([where(t, 'tl'), where(t, 'tlListed'), where(t, 'focal')], ['bar', 'bar', 'bar']) && t.w.document.querySelectorAll('.tg-wrap').length === 3 && same(t.texts('#tl'), ['✓', '解除']), [where(t, 'tl'), t.w.document.querySelectorAll('.tg-wrap').length]);
  narrow.set(true); await t.sleep(60);
  check('N10 また狭くなったら左下へ戻す', same([where(t, 'tl'), where(t, 'focal')], ['tl+side', 'bar']) && t.w.document.querySelectorAll('.tg-wrap').length === 3, [where(t, 'tl'), where(t, 'focal')]);
  // ボタンが要らなくなったら入れ物ごと消す
  await t.click('解除', '#tl'); await t.click('先行版扱い', '#tl');
  t.menu['設定を開く'](); q(t, '#tg-white').value = 'tg_test_u'; q(t, '#tg-local').value = 'tg_test_a'; q(t, '#tg-save').click(); await t.sleep(120);
  check('N11 「戻す」だけになっても左下に出る', same(t.texts('#tl'), ['戻す']) && where(t, 'tl') === 'tl+side', [t.texts('#tl'), where(t, 'tl')]);
  // 同じ要素が個別ページの本文の投稿として使い回されたら（tabindex が変わる）、行の中へ移す
  q(t, '#tlListed').setAttribute('tabindex', '-1');
  t.w.document.body.appendChild(t.w.document.createElement('div')); await t.sleep(120);   // 次の走査を起こす
  check('N12 タイムラインの投稿が個別ページの本文の投稿に変わったら、行の中へ移す', where(t, 'tlListed') === 'bar' && t.w.document.querySelectorAll('#tlListed .tg-wrap').length === 1, where(t, 'tlListed'));
  t.close();
});
