// usage: node test/ytplayer.js [userscript path]
// YouTube の再生中の動画: リストのチャンネルの動画が始まったら止めてぼかす（再生ページ・Shorts）。
const { boot, check, main } = require('./env');

const V = { a: 'AAAAAAAAAA1', b: 'BBBBBBBBBB1', a2: 'AAAAAAAAAA2', x: 'XXXXXXXXXX1' };
const OWNER = { [V.a]: 'tg_test_a|Test Channel A', [V.a2]: 'tg_test_a|Test Channel A', [V.b]: 'tg_test_b', [V.x]: 'error' };
const oembed = id => OWNER[id] || 404;
// 再生ページと Shorts の両方のプレーヤーを置いておく（実際のページでも、使っていないほうが隠れて残る）
const HTML = `<!doctype html><body>
  <div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><div class="ytp-chrome-bottom">controls</div></div>
  <ytd-watch-metadata><h1>video title</h1></ytd-watch-metadata>
  <div id="shorts-player"><video></video></div>
  <yt-shorts-video-title-view-model>shorts title</yt-shorts-video-title-view-model>
  <ytd-video-renderer id="card"><ytd-thumbnail><a href="/watch?v=${V.a2}"><img></a></ytd-thumbnail><h3><a href="/watch?v=${V.a2}">t</a></h3><ytd-channel-name><a href="/@tg_test_a">n</a></ytd-channel-name></ytd-video-renderer>
</body>`;
const gmOn = (clicks = 1) => new Map([['tg_cfg', JSON.stringify({ yt: true, clicks })], ['tg_local', '["yt:@tg_test_a"]']]);
const q = (t, sel) => t.w.document.querySelector(sel);
const pl = (t, sel) => q(t, sel).getAttribute('data-tg-pl');
const go = async (t, path) => { t.w.history.pushState({}, '', path); t.w.document.dispatchEvent(new t.w.Event('yt-navigate-finish')); await t.sleep(60); };
// 再生が sec 秒まで進んだことにする
const advance = async (t, v, sec) => { v.currentTime = sec; v.dispatchEvent(new t.w.Event('timeupdate')); await t.sleep(10); };
const clickIn = async (t, sel) => {
  let reached = false; const on = () => { reached = true; };
  t.w.document.addEventListener('click', on, true); t.w.addEventListener('click', on, true);
  q(t, sel).click();
  t.w.document.removeEventListener('click', on, true); t.w.removeEventListener('click', on, true);
  await t.sleep(30);
  return reached;
};

main(async () => {
  // 再生ページ: リストのチャンネルの動画
  let t = await boot(HTML, gmOn(2), { url: `https://www.youtube.com/watch?v=${V.a}&t=10s`, oembed });
  const mv = q(t, '#movie_player video');
  check('P1 リストのチャンネルの動画は、プレーヤーにクッションを掛けて止める', pl(t, '#movie_player') === '2' && q(t, '#movie_player').getAttribute('data-tg-pl-name') === 'Test Channel A' && q(t, 'ytd-watch-metadata h1').hasAttribute('data-tg-pltitle') && !q(t, '#shorts-player').hasAttribute('data-tg-pl'), [pl(t, '#movie_player'), q(t, '#movie_player').getAttribute('data-tg-pl-name')]);
  check('P2 文言とぼかしの規則がある。隠されているプレーヤーも出す', /\[data-tg-pl\] > \* \{ filter: blur\(40px\)/.test(t.styles.join('\n')) && t.styles.join('\n').includes("'クリックで再生'") && /\[data-tg-pl\] \{[^}]*visibility: visible !important/.test(t.styles.join('\n')));
  await mv.play(); await t.sleep(20);
  check('P3a 始まったばかりの再生は止めない（止めると Shorts が次へ進めなくなる）。音だけ消す', mv.paused === false && mv.muted === true && !mv.__pauses, [mv.paused, mv.muted, mv.__pauses]);
  await advance(t, mv, 0.1);
  check('P3b 少し進んだだけではまだ止めない', mv.paused === false && mv.muted === true);
  await advance(t, mv, 0.35);
  check('P3c 再生が進み始めたら止めて、音を元に戻す', mv.paused === true && mv.muted === false && mv.__pauses === 1, [mv.paused, mv.muted, mv.__pauses]);
  await mv.play(); await t.sleep(20);
  check('P3d 途中から再生されたら、すぐ止める', mv.paused === true && mv.__pauses === 2, [mv.paused, mv.__pauses]);
  // 押下はページに渡さない
  let got = 0; const onDown = () => { got++; };
  t.w.document.addEventListener('mousedown', onDown, true);
  q(t, '#movie_player .ytp-chrome-bottom').dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true }));
  q(t, 'ytd-watch-metadata h1').dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true }));
  t.w.document.removeEventListener('mousedown', onDown, true);
  check('P4 クッションの間、プレーヤーの上の押下はページに届かない（他の場所は届く）', got === 1, got);
  const r1 = await clickIn(t, '#movie_player video');
  check('P5 設定 2: 1 回目は残り回数が減るだけ。ページには届かない', r1 === false && pl(t, '#movie_player') === '1' && mv.paused === true, [r1, pl(t, '#movie_player')]);
  const plays0 = mv.__plays || 0;
  const r2 = await clickIn(t, '#movie_player video');
  check('P6 2 回目で外れて再生する。タイトルのぼかしも外れる', r2 === false && !q(t, '[data-tg-pl]') && !q(t, '[data-tg-pltitle]') && mv.paused === false && mv.__plays === plays0 + 1, [r2, mv.paused, mv.__plays]);
  const r3 = await clickIn(t, '#movie_player video');
  check('P7 外れた後のクリックはそのままページに渡る', r3 === true && !q(t, '[data-tg-pl]'));

  // ページを移る（SPA）
  await go(t, `/watch?v=${V.b}`);
  check('Q1 リストに無いチャンネルの動画には掛けない', !q(t, '[data-tg-pl]'));
  const sv = q(t, '#shorts-player video');
  await sv.play();   // 次の動画が始まった（currentTime は 0 から）
  await go(t, `/shorts/${V.a2}`);
  check('Q2 Shorts の送りでリストのチャンネルの動画が始まったら、すぐぼかして音を消す（まだ止めない）', pl(t, '#shorts-player') === '2' && q(t, 'yt-shorts-video-title-view-model').hasAttribute('data-tg-pltitle') && !q(t, '#movie_player').hasAttribute('data-tg-pl') && sv.paused === false && sv.muted === true, [pl(t, '#shorts-player'), sv.paused, sv.muted]);
  await advance(t, sv, 0.4);
  check('Q2a 再生が進み始めたところで止める', sv.paused === true && sv.muted === false && sv.__pauses === 1, [sv.paused, sv.muted, sv.__pauses]);
  // 次の動画は、URL が変わるより先に同じ video 要素で再生が始まる（実際の順序）。クッションが残っている間なので一度止まる
  sv.currentTime = 0; await sv.play(); await t.sleep(10);
  check('Q3a URL が変わる前に始まった次の動画は、止めずに音だけ消しておく', sv.paused === false && sv.muted === true, [sv.paused, sv.muted]);
  await go(t, `/shorts/${V.b}`);
  check('Q3 次の Shorts がリストに無ければ外す。再生は続き、音も戻る', !q(t, '[data-tg-pl]') && !q(t, '[data-tg-pltitle]') && sv.paused === false && sv.muted === false, [sv.paused, sv.muted]);
  // URL が変わるのが遅れて、次の動画を止めてしまった場合は、移った後で再生を戻す
  await go(t, `/shorts/${V.a2}`); await advance(t, sv, 0.4);
  check('Q3b 準備: 掛かって止まっている', pl(t, '#shorts-player') === '2' && sv.paused === true);
  sv.currentTime = 0; await sv.play(); await advance(t, sv, 0.4);
  check('Q3c 準備: 次の動画が進んだところで止めてしまった', sv.paused === true);
  await go(t, `/shorts/${V.b}`);
  check('Q3d 移った先がリストに無ければ、止めてしまった再生を戻す', !q(t, '[data-tg-pl]') && sv.paused === false && sv.muted === false, [sv.paused, sv.muted]);
  await go(t, `/watch?v=${V.a}`);
  check('Q4 一度表示にした動画に戻っても掛けない', !q(t, '[data-tg-pl]'));
  await go(t, `/watch?v=${V.x}`);
  check('Q5 チャンネルが引けない動画には掛けない', !q(t, '[data-tg-pl]'));
  await go(t, '/results?search_query=x');
  check('Q6 動画のページでなければ何もしない', !q(t, '[data-tg-pl]'));

  // カードを表示してから開いた動画には掛けない
  await go(t, `/shorts/${V.a2}`);
  check('R0 準備: 掛かっている', pl(t, '#shorts-player') === '2');
  await go(t, '/results?search_query=x');
  await clickIn(t, '#card ytd-thumbnail img'); await clickIn(t, '#card ytd-thumbnail img');   // 設定 2: タイトル → サムネイル
  check('R1 準備: カードを表示にした', !q(t, '#card').hasAttribute('data-tg-blur'));
  await go(t, `/watch?v=${V.a2}`);
  check('R2 表示にしたカードの動画を開いても掛けない', !q(t, '[data-tg-pl]'));
  t.close();

  // リストから外したら、掛けていたクッションも外れる
  const gm = gmOn(1);
  t = await boot(HTML, gm, { url: `https://www.youtube.com/watch?v=${V.a}`, oembed });
  check('S0 準備: 掛かっている（設定 1）', pl(t, '#movie_player') === '1');
  await t.click('解除', '#card'); await t.sleep(120);
  check('S1 「解除」でクッションも外れる（勝手に再生はしない）', !q(t, '[data-tg-pl]') && q(t, '#movie_player video').paused === true && !(q(t, '#movie_player video').__plays > 0), [q(t, '#movie_player video').__plays]);
  await t.click('先行版扱い', '#card'); await t.sleep(120);
  check('S2 入れ直すと、また掛かる', pl(t, '#movie_player') === '1');
  t.close();

  // 設定が切なら何もしない。X でも何もしない
  t = await boot(HTML, new Map([['tg_local', '["yt:@tg_test_a"]']]), { url: `https://www.youtube.com/watch?v=${V.a}`, oembed });
  check('T1 設定が切なら掛けない（通信もしない）', !q(t, '[data-tg-pl]') && t.fetches.length === 0);
  t.close();
});
