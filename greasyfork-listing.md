# Greasy Fork 掲載用テキスト

名前と一行の説明はスクリプトのヘッダ（`@name` / `@name:ja` / `@name:ko`、`@description` / `@description:ja` / `@description:ko`）から入る。
以下は「追加情報」。Greasy Fork では言語ごとに追加情報を入れられるので、英語を既定にし、日本語と韓国語をそれぞれの言語の欄に入れる。
`##` の見出しは欄の名前で、貼るのは `###` から下。

## English (default)

### What is this?
A spoiler cushion for Trickcal players, for X (Twitter) and YouTube. It blurs posts and video thumbnails from the accounts you mark, and shows them only when you click. Unlike mute or block, nothing is removed — you decide whether to look.
- Playing the global version: the shared list (experimental; accounts that post advance-version content) is on by default.
- Playing the Korean version: the shared list is off by default. Add channels that put spoilers in their thumbnails with the "Blur" button.

### What it does
- X: blurs text, images, videos and quote cards; account names stay visible. Judged by the post's author. A quoted post blurs only the quote card.
- YouTube (on by default; can be turned off in settings): blurs thumbnails and titles in search results, the home page, the watch-page sidebar and the Shorts shelf; channel names stay visible. Blurred cards do not autoplay on hover. If autoplay or the next Short starts a video from a blurred channel, the player pauses and blurs until you click.
- Click to show that one post. The default is 2 clicks (text first, then images); adjustable from 1 to 5.
- The "…" menu still works on blurred posts, so you can mute or block as usual.
- Posts that link to fusetter / poipiku / privatter are not blurred.
- Not keyword based, so posts with no text are blurred too.
- Your own lists (blur / always show) stay on your device. The shared list is experimental and can be turned off.
- Interface in English, Japanese and Korean. Follows the browser language; changeable in settings.

### How to use
1. Install Tampermonkey and this script, then open X or YouTube.
2. Press "Blur" on an account you want blurred. On X the button is at the right end of the row under the post (on narrow screens, at the post's lower left). On YouTube it appears at the lower right of a video card when you hover. This is a device-only setting.
3. Settings: Tampermonkey menu → "Open settings".

### Data
This script sends nothing to the author. It fetches the shared list from a public Google Sheet from time to time; the list holds hashed account names, not plain names, and the request carries no cookies. On YouTube, for video cards that do not show the channel (Shorts and similar), it asks YouTube (oEmbed) which channel the video belongs to; results are kept on your device so the same video is not asked again.

### Notes
- Changes to X or YouTube may break it. Please leave feedback if you notice.
- Playback or moving to the next video in YouTube Shorts may occasionally misbehave. If so, turn off "Also use on YouTube" in the settings.
- It does not catch everything. It is a tool for not seeing what you do not want to see.

## 日本語

### これは何？
グローバル版トリッカル（Trickcal / トリッカル・もちもちほっぺ大作戦）の進度で遊んでいる方向けの、X（Twitter）と YouTube 用のネタバレ回避（ネタバレ防止）スクリプトです。
先行版（本国版・韓国版）の内容を投稿しているアカウントの投稿をぼかし、クリックしたときだけ表示します。
ミュートやブロックと違って投稿は消さず、見るかどうかを自分で決める「ワンクッション」を挟むだけです。
YouTube でも同じように、チャンネル単位で動画のサムネイルとタイトルをぼかします。

### できること
- 本文・画像・動画・引用カードをぼかす（アカウント名は見える）
- 判定するのは、その投稿を書いたアカウント。リポストで流れてきた投稿も同じ基準で、引用は引用カードだけをぼかす
- クリックでその投稿だけ表示。初期設定は 2 回（本文 → 画像）で、1〜5 回に変更可能
- ぼかしたままでも「…」メニューからミュート・ブロックできる
- ふせったー・ポイピク・privatter のリンクがある投稿はぼかさない
- キーワード判定ではないので、テキストのない絵の投稿もぼかせる。ミュートワードでは防げない画像のネタバレ対策に
- 配布リスト（実験的）は自動更新。アカウント名は平文では持たず、ハッシュ値だけを配布
- 自分でアカウントを追加・除外できる（端末内に保存）。配布リストを使わない設定も可能
- YouTube（初期設定で入。設定で切にできる）: 検索結果・ホーム・再生ページの横の一覧・Shorts の棚で、サムネイルとタイトルをぼかす。判定はチャンネル単位で、チャンネル名は見える（チャンネル名の出ない Shorts は、ぼかしの上にチャンネル名を出す）。ぼかしている間はカーソルを乗せても自動再生しない。自動再生や Shorts の送りでそのチャンネルの動画が始まったときは、止めてぼかす（クリックで再生）
- 表示は日本語・英語・韓国語。ブラウザの言語に合わせ、設定で変えられる

### 使い方
1. Tampermonkey とこのスクリプトをインストールして、X を開く
2. 自分でぼかしたいアカウントは「先行版扱い」を押す。ボタンは投稿の下の並び（返信・リポスト・いいね）の右端に小さく出ます（幅の狭い画面では投稿の左下）。この端末だけの設定です
3. 設定は Tampermonkey メニュー →「設定を開く」
4. YouTube では、「先行版扱い」は動画のカードにカーソルを乗せると右下に出ます

### 送信するデータについて
このスクリプトは作者に何も送信しません。
配布リストは公開の Google スプレッドシートから定期的に取得します。リストにあるのはアカウント名のハッシュ値で、平文の名前ではありません。この取得で、投稿の内容・端末内のリスト・端末 ID などを送ることはなく、Google のクッキーも付けません。
YouTube では、チャンネルへのリンクが無い動画カード（Shorts など）のチャンネルを調べるために、その動画の ID を YouTube（oEmbed）に問い合わせます。結果は端末内に保存して、同じ動画を繰り返し問い合わせることはしません。

### 注意
- X や YouTube の仕様変更で動かなくなることがあります。気づいたらフィードバックで教えてください
- YouTube の Shorts では、再生や次の動画への移動がうまく動かないことがあります。そのときは設定で「YouTube でも使う」を切にしてください
- 未実装キャラや先行情報を完全に防ぐものではありません。あくまで、見たくないものを見ないための道具です

## 한국어

### 이게 뭔가요?
트릭컬 플레이어를 위한 X(트위터)·YouTube용 스포일러 원쿠션입니다. 직접 지정한 계정의 글과 동영상 썸네일을 가리고, 클릭했을 때만 보여 줍니다. 뮤트나 차단과 달리 아무것도 없애지 않습니다. 볼지 말지는 본인이 정합니다.
- 국내판을 플레이한다면: 새 콘텐츠가 나오자마자 핵심을 썸네일에 박아 올리는 채널을 「가리기」로 추가하면 됩니다. 공유 목록(실험적 기능. 선행판 내용을 올리는 계정)은 기본 꺼짐입니다.
- 글로벌판을 플레이한다면: 공유 목록이 기본 켜짐입니다.

### 할 수 있는 것
- X: 본문·이미지·동영상·인용 카드를 가립니다. 계정 이름은 보입니다. 판정은 글을 쓴 계정 기준이고, 인용글은 인용 카드만 가립니다.
- YouTube(기본 켜짐, 설정에서 끌 수 있음): 검색 결과·홈·재생 페이지 옆 목록·Shorts 선반의 썸네일과 제목을 가립니다. 채널 이름은 보입니다. 가려진 카드는 마우스를 올려도 자동 재생되지 않습니다. 자동 재생이나 Shorts 넘김으로 가린 채널의 영상이 시작되면, 클릭할 때까지 멈추고 가립니다.
- 클릭하면 그 글만 표시됩니다. 기본은 2번(본문 → 이미지)이고 1~5번으로 바꿀 수 있습니다.
- 가려진 글에서도 「…」 메뉴는 그대로 쓸 수 있습니다.
- fusetter / poipiku / privatter 링크가 있는 글은 가리지 않습니다.
- 키워드 판정이 아니라서 글자가 없는 그림 글도 가립니다.
- 직접 만든 목록(가리기 / 항상 표시)은 기기 안에만 저장됩니다. 공유 목록은 실험적 기능이며 끌 수 있습니다.
- 한국어·영어·일본어 표시. 브라우저 언어를 따르고, 설정에서 바꿀 수 있습니다.

### 사용법
1. Tampermonkey와 이 스크립트를 설치하고 X나 YouTube를 엽니다.
2. 가리고 싶은 계정에서 「가리기」를 누릅니다. X에서는 글 아래 줄(답글·리포스트·좋아요)의 오른쪽 끝에 작게 나오고(좁은 화면에서는 글의 왼쪽 아래), YouTube에서는 동영상 카드에 마우스를 올리면 오른쪽 아래에 나옵니다. 이 기기에만 저장됩니다.
3. 설정은 Tampermonkey 메뉴 → 「설정 열기」.

### 데이터
이 스크립트는 제작자에게 아무것도 보내지 않습니다. 공유 목록은 공개 Google 스프레드시트에서 가끔 받아 옵니다. 목록에 있는 것은 계정 이름의 해시값이지 평문 이름이 아니며, 요청에 쿠키를 붙이지 않습니다. YouTube에서는 채널이 표시되지 않는 동영상 카드(Shorts 등)의 채널을 알아내기 위해 그 동영상의 ID를 YouTube(oEmbed)에 조회합니다. 결과는 기기 안에 저장해서 같은 동영상을 다시 조회하지 않습니다.

### 주의
- X나 YouTube의 변경으로 동작하지 않게 될 수 있습니다. 발견하면 피드백으로 알려 주세요.
- YouTube Shorts에서 재생이나 다음 영상으로의 이동이 가끔 잘 안 될 수 있습니다. 그럴 때는 설정에서 「YouTube에서도 사용」을 끄세요.
- 모든 스포일러를 막아 주지는 않습니다. 보고 싶지 않은 것을 보지 않기 위한 도구입니다.
