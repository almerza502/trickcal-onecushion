// usage: node test/youtube.js [userscript path]
// YouTube: カードのチャンネルを DOM か oEmbed で求め、チャンネル単位でぼかす。
const { createHash } = require('crypto');
const { boot, check, main, code } = require('./env');

const SALT = (code.match(/const SALT = '([^']+)'/) || [])[1];
const csv = (...keys) => ({ status: 200, responseText: keys.map(k => `"${createHash('sha256').update(k + SALT).digest('hex')}"`).join('\n') });
const URL = 'https://www.youtube.com/results?search_query=x';

// 検索結果のカード（チャンネルのリンクあり）
const search = (id, vid, handle) => `<ytd-video-renderer id="${id}"><ytd-thumbnail><a id="thumbnail" href="/watch?v=${vid}&pp=abc"><img src="https://i.ytimg.com/vi/${vid}/hq720.jpg"></a></ytd-thumbnail>
  <h3><a id="video-title" href="/watch?v=${vid}&pp=abc">title</a></h3>
  <ytd-channel-name><a href="/${handle}">name</a></ytd-channel-name>
  <div class="metadata-snippet-container">snippet</div>
  <ytd-expandable-metadata-renderer><h3>chapter</h3></ytd-expandable-metadata-renderer></ytd-video-renderer>`;
// Shorts の棚のカード（チャンネルの情報なし）
const shorts = (id, vid) => `<ytm-shorts-lockup-view-model id="${id}"><a href="/shorts/${vid}"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a>
  <h3><a href="/shorts/${vid}">title</a></h3></ytm-shorts-lockup-view-model>`;
// 再生ページの横の一覧のカード（チャンネルは名前の文字だけ）
const lockup = (id, vid) => `<yt-lockup-view-model id="${id}"><a href="/watch?v=${vid}"><yt-thumbnail-view-model><img></yt-thumbnail-view-model></a>
  <h3><a href="/watch?v=${vid}">title</a></h3><span>channel name</span></yt-lockup-view-model>`;
const V = { a1: 'AAAAAAAAAA1', b1: 'BBBBBBBBBB1', a2: 'AAAAAAAAAA2', b2: 'BBBBBBBBBB2', a3: 'AAAAAAAAAA3', x1: 'XXXXXXXXXX1', n1: 'NNNNNNNNNN1', h1: 'HHHHHHHHHH1' };
const HTML = `<!doctype html><body>
  ${search('sA', V.a1, '@TG_Test_A')}
  ${search('sB', V.b1, '@tg_test_b')}
  ${search('sN', V.n1, '@%E3%83%86%E3%82%B9%E3%83%88')}
  ${shorts('shA', V.a2)}
  ${shorts('shB', V.b2)}
  ${shorts('shX', V.x1)}
  ${lockup('lA', V.a3)}
  <yt-lockup-view-model id="pl"><a href="/playlist?list=PL1">list</a><h3>playlist</h3></yt-lockup-view-model>
</body>`;
// 動画 ID -> oEmbed が返すハンドル
const OWNER = { [V.a2]: 'TG_Test_A|Test Channel A', [V.b2]: 'tg_test_b', [V.a3]: 'tg_test_a', [V.x1]: 'error', [V.h1]: 'hang' };
const oembed = id => OWNER[id] || 404;

const on = (extra = {}) => new Map([['tg_cfg', JSON.stringify({ yt: true, clicks: 1, ...extra })]]);
const q = (t, sel) => t.w.document.querySelector(sel);
const blurred = (t, sel) => q(t, sel).hasAttribute('data-tg-blur');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// ページ側にクリックが届いたか。document の capture と、スクリプトより後に window に付けた capture の両方で見る
const clickIn = async (t, sel) => {
  let reached = false; const onDoc = () => { reached = true; };
  t.w.document.addEventListener('click', onDoc, true);
  t.w.addEventListener('click', onDoc, true);
  q(t, sel).click();
  t.w.document.removeEventListener('click', onDoc, true);
  t.w.removeEventListener('click', onDoc, true);
  await t.sleep(30);
  return reached;
};

main(async () => {
  // 設定が切のとき（既定）は何もしない
  let t = await boot(HTML, new Map([['tg_local', '["yt:@tg_test_a"]']]), { url: URL, oembed });
  check('A1 既定では YouTube で動かない（ぼかし・通信・ボタンなし）', !q(t, '[data-tg-blur]') && t.fetches.length === 0 && t.gets.length === 0 && t.texts().length === 0, [t.fetches.length, t.gets.length, t.texts()]);
  t.menu['設定を開く']();
  check('A2 パネルに切替がある（既定は切）', q(t, '#tg-yt') && q(t, '#tg-yt').checked === false);
  q(t, '#tg-yt').checked = true;
  q(t, '#tg-save').click(); await t.sleep(120);
  check('A3 入にして保存すると、その場で動き出す（配布リストも取りに行く）', blurred(t, '#sA') && JSON.parse(t.w.GM_getValue('tg_cfg')).yt === true && t.gets.length === 1, [t.w.GM_getValue('tg_cfg'), t.gets.length]);
  t.close();

  // 端末のリスト
  let gm = on(); gm.set('tg_local', '["yt:@tg_test_a"]');
  t = await boot(HTML, gm, { url: URL, oembed });
  check('B1 リンクのあるカード: リストのチャンネルだけぼかす（ハンドルの大文字は区別しない）', blurred(t, '#sA') && !blurred(t, '#sB') && !blurred(t, '#sN'));
  check('B2 リンクの無いカード: 動画 ID から引いてぼかす', blurred(t, '#shA') && blurred(t, '#lA') && !blurred(t, '#shB'));
  check('B2a チャンネル名の出ないカード（Shorts）には、ぼかしている間チャンネル名を付ける。他のカードには付けない', q(t, '#shA').dataset.tgName === 'Test Channel A' && !q(t, '#sA').dataset.tgName && !q(t, '#lA').dataset.tgName && !q(t, '#shB').dataset.tgName, [q(t, '#shA').dataset.tgName, q(t, '#lA').dataset.tgName]);
  check('B2b 文言の規則にチャンネル名の行がある', t.styles.join('\n').includes("[data-tg-blur][data-tg-name]::after { content: attr(data-tg-name) '\\A' 'クリックで表示'"));
  check('B3 引けなかったカードはぼかさない。ボタンも出さない', !blurred(t, '#shX') && same(t.texts('#shX'), []), t.texts('#shX'));
  check('B4 引くのはリンクの無いカードだけ。クッキーは付けない', same(t.fetches.map(f => f.id).sort(), [V.a2, V.a3, V.b2, V.x1].sort()) && t.fetches.every(f => f.init.credentials === 'omit'), t.fetches.map(f => f.id));
  check('B5 動画で無いカード（再生リスト）は触らない', !q(t, '#pl').dataset.tgKey && !blurred(t, '#pl'));
  check('B6 ボタン: リストのチャンネルは「解除」、それ以外は「先行版扱い」', same(t.texts('#sA'), ['解除']) && same(t.texts('#shA'), ['解除']) && same(t.texts('#sB'), ['先行版扱い']) && same(t.texts('#shB'), ['先行版扱い']), [t.texts('#sA'), t.texts('#shA'), t.texts('#sB'), t.texts('#shB')]);
  await t.sleep(600);
  const saved = JSON.parse(gm.get('tg_yt_vid') || '{}');
  check('B7 引いた結果は保存する（引けなかったものは保存しない）', saved[V.a2] === 'tg_test_a' && saved[V.b2] === 'tg_test_b' && !(V.x1 in saved), saved);

  // 押して表示。YouTube 自身のクリック処理には渡さない
  const reached = await clickIn(t, '#sA ytd-thumbnail img');
  check('C1 ぼかしを押すと表示。ページ側には届かない', reached === false && !blurred(t, '#sA'), [reached, blurred(t, '#sA')]);
  const reached2 = await clickIn(t, '#sA ytd-thumbnail img');
  check('C2 表示後のクリックはそのままページに渡る', reached2 === true);
  // hover: ぼかしているカードの中の hover はページ側に届かない
  let got = 0; const onOver = () => { got++; };
  t.w.document.addEventListener('mouseover', onOver);
  q(t, '#shA h3').dispatchEvent(new t.w.MouseEvent('mouseover', { bubbles: true }));
  q(t, '#shB h3').dispatchEvent(new t.w.MouseEvent('mouseover', { bubbles: true }));
  t.w.document.removeEventListener('mouseover', onOver);
  check('C3 ぼかしているカードの hover はページに届かない（他のカードは届く）', got === 1, got);

  // 「先行版扱い」: そのチャンネルのカードが全部ぼける
  await t.click('先行版扱い', '#sB');
  await t.sleep(80);
  check('D0 表示名の分からないチャンネルは @ハンドル を出す', q(t, '#shB').dataset.tgName === '@tg_test_b', q(t, '#shB').dataset.tgName);
  check('D1 「先行版扱い」でそのチャンネルのカードを全部ぼかす', blurred(t, '#sB') && blurred(t, '#shB') && JSON.parse(gm.get('tg_local')).includes('yt:@tg_test_b'), gm.get('tg_local'));
  check('D2 引き直さない（保存した結果を使う）', t.fetches.filter(f => f.id === V.b2).length === 1, t.fetches.map(f => f.id));
  await t.click('解除', '#sB');
  await t.sleep(80);
  check('D3 「解除」で戻る（チャンネル名の印も消える）', !blurred(t, '#sB') && !blurred(t, '#shB') && !q(t, '#shB').dataset.tgName && same(t.texts('#sB'), ['先行版扱い']));
  // 日本語のハンドル
  await t.click('先行版扱い', '#sN');
  check('D4 パーセント符号化されたハンドルは元の文字で保存する', JSON.parse(gm.get('tg_local')).includes('yt:@テスト') && blurred(t, '#sN'), gm.get('tg_local'));

  // カードの要素が使い回され、リンク先だけ変わったとき（直前の操作による走査が済んでから変える）
  await t.sleep(300);
  q(t, '#shA').querySelectorAll('a').forEach(a => a.setAttribute('href', '/shorts/' + V.b2));
  await t.sleep(200);
  check('E1 リンク先が変わったカードは判定し直す', !blurred(t, '#shA') && q(t, '#shA').dataset.tgVid === V.b2, q(t, '#shA').dataset.tgVid);
  // 引くのに時間がかかる動画に変わったとき、前の動画のボタンを残さない
  check('E2 準備: 前の動画のボタンがある', same(t.texts('#lA'), ['解除']), t.texts('#lA'));
  await t.sleep(300);
  q(t, '#lA').querySelectorAll('a').forEach(a => a.setAttribute('href', '/watch?v=' + V.h1));   // 応答が返らない動画
  await t.sleep(300);
  check('E3 引いている間は、前の動画のボタンもぼかしも残さない', same(t.texts('#lA'), []) && !blurred(t, '#lA') && q(t, '#lA').dataset.tgVid === V.h1, [t.texts('#lA'), q(t, '#lA').dataset.tgVid]);
  t.close();

  // 読み込み直したあとは、保存した結果で判定する（引かない）
  t = await boot(HTML, gm, { url: URL, oembed });
  check('F1 再読込後は保存した結果を使い、引けなかった動画だけ引き直す（表示名も保存したものを使う）', blurred(t, '#shA') && q(t, '#shA').dataset.tgName === 'Test Channel A' && same(t.fetches.map(f => f.id), [V.x1]), [t.fetches.map(f => f.id), q(t, '#shA').dataset.tgName]);
  // 設定パネルで保存しても yt: の行は消えない
  t.menu['設定を開く']();
  const before = q(t, '#tg-local').value.split('\n').sort();
  q(t, '#tg-save').click(); await t.sleep(120);
  check('F2 パネルに yt:@ の行が出て、保存しても残る', before.includes('yt:@tg_test_a') && before.includes('yt:@テスト') && same(JSON.parse(gm.get('tg_local')).sort(), before), [before, gm.get('tg_local')]);
  // 切にすると印を全部外す
  t.menu['設定を開く']();
  q(t, '#tg-yt').checked = false;
  q(t, '#tg-save').click(); await t.sleep(120);
  check('F3 切にするとぼかしもボタンも消える', !q(t, '[data-tg-blur]') && t.texts().length === 0 && !q(t, '.tg-row'), t.texts());
  t.close();

  // 段階的な表示（設定 2）: タイトル → サムネイル
  gm = on({ clicks: 2 }); gm.set('tg_local', '["yt:@tg_test_a"]');
  t = await boot(HTML, gm, { url: URL, oembed });
  const st = sel => { const el = q(t, sel); return el.hasAttribute('data-tg-blur') ? `${el.getAttribute('data-tg-blur')}${el.hasAttribute('data-tg-text') ? '+text' : ''}` : 'shown'; };
  const seq = [st('#sA')];
  await clickIn(t, '#sA h3 a'); seq.push(st('#sA'));
  const passed = await clickIn(t, '#sA h3 a');             // 表示済みのタイトルは普通のリンク
  await clickIn(t, '#sA ytd-expandable-metadata-renderer h3');   // チャプターの行はまだぼかしの中 → 数える
  seq.push(st('#sA'));
  check('G1 設定 2: タイトル → サムネイルの順', same(seq, ['28', '28+text', 'shown']) && passed === true, [seq, passed]);
  t.close();

  // 配布リスト
  t = await boot(HTML, on(), { url: URL, oembed, remote: () => csv('yt:@tg_test_a') });
  check('H1 配布リストのチャンネルをぼかす。ボタンは出さない', blurred(t, '#sA') && blurred(t, '#shA') && !blurred(t, '#sB') && same(t.texts('#sA'), []), t.texts('#sA'));
  await clickIn(t, '#sA ytd-thumbnail img');
  check('H2 表示後は「常に表示 @x」', same(t.texts('#sA'), ['常に表示 @tg_test_a']), t.texts('#sA'));
  await t.click('常に表示 @tg_test_a', '#sA');
  await t.sleep(80);
  check('H3 常に表示にすると、そのチャンネルは全部ぼかさない。「戻す」が出る', !blurred(t, '#shA') && same(t.texts('#shA'), ['戻す']) && JSON.parse(t.w.GM_getValue('tg_white')).includes('yt:@tg_test_a'), t.texts('#shA'));
  t.close();

  // 引けなかった動画は、しばらくしてから引き直す（同じページの中でも）
  const gm2 = on(); gm2.set('tg_local', '["yt:@tg_test_a"]');
  const clock = { now: 1_800_000_000_000 };
  t = await boot(HTML, gm2, { url: URL, oembed, clock });
  const nx = () => t.fetches.filter(f => f.id === V.x1).length;
  check('J1 準備: 引けなかった', nx() === 1 && !blurred(t, '#shX'), nx());
  await t.click('先行版扱い', '#sB'); await t.sleep(80);   // 全件を判定し直す
  check('J2 直後に判定し直しても引き直さない', nx() === 1 && !blurred(t, '#shX'), nx());
  clock.now += 61 * 1000; OWNER[V.x1] = 'tg_test_a';
  await t.click('解除', '#sB'); await t.sleep(80);
  check('J3 しばらくたってから判定し直したら引き直す。今度は引けたのでぼかす', nx() === 2 && blurred(t, '#shX'), [nx(), blurred(t, '#shX')]);
  OWNER[V.x1] = 'error';
  t.close();

  // X では YouTube の処理は動かない
  t = await boot(HTML, on(), { oembed });
  check('I1 X では YouTube のカードに触らない', !q(t, '[data-tg-card]') && t.fetches.length === 0);
});
