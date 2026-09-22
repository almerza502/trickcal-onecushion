// usage: node test/i18n.js [userscript path]
// 文言の言語: 設定 > ブラウザの言語 > 英語。言語ごとの既定値、公開ビルド（報告なし）。
const { boot, check, main, code } = require('./env');

const head = (h, id) => `<div data-testid="User-Name"><a href="/${h}"><span>N</span></a>
  <a href="/${h}/status/${id}"><time datetime="2026-09-19T00:00:00.000Z">1h</time></a></div>`;
const text = '<div data-testid="tweetText">text</div>';
const bar = '<div role="group"><button data-testid="reply"></button></div>';
const HTML = `<!doctype html><body>
  <article data-testid="tweet" tabindex="0" id="u">${head('tg_test_u', 1)}${text}${bar}</article>
  <article data-testid="tweet" tabindex="0" id="a">${head('tg_test_a', 2)}${text}${bar}</article>
</body>`;
const q = (t, sel) => t.w.document.querySelector(sel);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastCss = t => t.styles[t.styles.length - 1];
const local = () => new Map([['tg_local', '["tg_test_a"]']]);

main(async () => {
  check('H0 ヘッダ: 名前は英語、日本語・韓国語の名前と説明がある', /@name\s+Trickcal One-Cushion\n/.test(code) && /@name:ja\s+\S/.test(code) && /@name:ko\s+\S/.test(code) && /@description:ja\s+\S/.test(code) && /@description:ko\s+\S/.test(code));
  check('H1 公開ビルドには報告の送信先が無い', code.includes("const FORM_URL = '';") && !/docs\.google\.com\/forms/.test(code));

  // ブラウザの言語に合わせる
  let t = await boot(HTML, local(), { post: 'ok', lang: 'en-US' });
  check('L1 英語のブラウザ: 英語の文言', same(t.texts('#u'), ['Blur']) && same(t.texts('#a'), ['Report', 'Unblur']), [t.texts('#u'), t.texts('#a')]);
  check('L1 ぼかしの文言も英語', lastCss(t).includes("content: 'May contain spoilers — Click to show';") && lastCss(t).includes("content: 'May contain spoilers — ' attr(data-tg-left) ' more clicks to show';"), lastCss(t).slice(0, 200));
  check('L1 title も英語', q(t, '#u .tg-btn').title === 'Blur this account on this device (nothing is sent)', q(t, '#u .tg-btn').title);
  t.menu['Open settings']();
  check('L1 パネルとメニューも英語。言語の選択は「自動」', !!q(t, '#tg-panel') && q(t, '#tg-lang').value === 'auto' && q(t, '#tg-save').textContent === 'Save', [q(t, '#tg-lang') && q(t, '#tg-lang').value]);
  t.close();
  t = await boot(HTML, local(), { post: 'ok', lang: 'ko-KR' });
  check('L2 韓国語のブラウザ: 韓国語の文言', same(t.texts('#u'), ['가리기']) && same(t.texts('#a'), ['제보', '가림 해제']), [t.texts('#u'), t.texts('#a')]);
  check('L2 ぼかしの文言も韓国語', lastCss(t).includes("content: '스포일러가 있을 수 있음 — 클릭해서 보기';") && lastCss(t).includes("attr(data-tg-left) '번 더 클릭하면 표시';"));
  t.close();
  t = await boot(HTML, local(), { post: 'ok', lang: 'fr-FR' });
  check('L3 対応していない言語のブラウザ: 英語', same(t.texts('#u'), ['Blur']), t.texts('#u'));
  t.close();
  t = await boot(HTML, local(), { post: 'ok' });
  check('L4 日本語のブラウザ: 日本語の文言（既存の検査と同じ）', same(t.texts('#u'), ['先行版扱い']) && same(t.texts('#a'), ['報告', '解除']), t.texts('#a'));

  // 設定で切り替える
  t.menu['設定を開く']();
  q(t, '#tg-lang').value = 'ko';
  q(t, '#tg-save').click(); await t.sleep(120);
  check('M1 設定で韓国語にすると、その場で文言が変わる', same(t.texts('#u'), ['가리기']) && same(t.texts('#a'), ['제보', '가림 해제']) && JSON.parse(t.w.GM_getValue('tg_cfg')).lang === 'ko', [t.texts('#u'), t.w.GM_getValue('tg_cfg')]);
  check('M1 ぼかしの文言の規則が足される（後のものが勝つ）', lastCss(t).includes('클릭해서 보기') && t.styles.length >= 3, t.styles.length);
  t.menu['設定を開く']();
  check('M2 パネルは韓国語で開き、選択は ko', q(t, '#tg-lang').value === 'ko' && q(t, '#tg-save').textContent === '저장');
  q(t, '#tg-lang').value = 'auto';
  q(t, '#tg-save').click(); await t.sleep(120);
  check('M3 「自動」に戻すと、ブラウザの言語（日本語）', same(t.texts('#u'), ['先行版扱い']), t.texts('#u'));
  t.close();
  // 他のタブで言語を変えたら、こちらにも届く
  const gm = local();
  const t1 = await boot(HTML, gm, {}), t2 = await boot(HTML, gm, {});
  t1.menu['設定を開く'](); q(t1, '#tg-lang').value = 'en'; q(t1, '#tg-save').click(); await t1.sleep(120);
  check('M4 他のタブの言語変更が届く', same(t2.texts('#u'), ['Blur']), t2.texts('#u'));
  t1.close(); t2.close();

  // 配布リストの既定値: 韓国語だけ切
  for (const [lang, want] of [['ja', true], ['en-US', true], ['ko-KR', false]]) {
    t = await boot(HTML, new Map(), { lang });
    t.menu[lang === 'ja' ? '設定を開く' : lang === 'ko-KR' ? '설정 열기' : 'Open settings']();
    check(`N1 ${lang}: 配布リストの既定は ${want ? '入' : '切'}`, q(t, '#tg-dist').checked === want && t.gets.length === (want ? 1 : 0), [q(t, '#tg-dist').checked, t.gets.length]);
    t.close();
  }
  t = await boot(HTML, new Map([['tg_cfg', JSON.stringify({ dist: true })]]), { lang: 'ko-KR' });
  check('N2 韓国語でも、保存してある設定が入なら入', t.gets.length === 1, t.gets.length);
  t.close();
  t = await boot(HTML, new Map([['tg_cfg', JSON.stringify({ lang: 'ko' })]]), { lang: 'ja' });
  t.menu['설정 열기']();
  check('N3 言語だけ保存してある端末: 既定の切は韓国語で決まる', q(t, '#tg-dist').checked === false);
  t.close();

  // 公開ビルドそのまま: 報告のボタンが出ない、パネルにも報告の項目が無い
  t = await boot(HTML, local(), { public: true });
  check('P1 公開ビルド: ローカルのアカウントには「解除」だけ', same(t.texts('#a'), ['解除']) && same(t.texts('#u'), ['先行版扱い']), t.texts('#a'));
  t.menu['設定を開く']();
  check('P2 公開ビルド: パネルに報告履歴の項目が無い。保存はできる', !q(t, '#tg-reset-rep') && !q(t, '#tg-pend') && !!q(t, '#tg-save'));
  q(t, '#tg-save').click(); await t.sleep(80);
  check('P3 公開ビルド: 保存しても壊れない', !q(t, '#tg-panel') && t.posts.length === 0);
  t.close();
});
