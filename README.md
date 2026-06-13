# Instant Daily Memo PWA

起動したらすぐ今日の日記を書ける PWA です。Android 版の体験を Web に移植し、今日のメモをブラウザ内に自動保存します。

公開 URL:

https://yoshimov.github.io/instantdailymemo-pwa/

## 機能

- 今日の日記を即入力
- 入力後 0.9 秒で自動保存
- オフライン起動
- PWA インストール
- Web Speech API 対応ブラウザで音声入力
- Web Share Target 対応ブラウザで共有テキスト追加
- Google Calendar API による今日の `memo` 終日予定の読み書き
- `.ics` と JSON の書き出し

## Google Calendar API の設定

1. Google Cloud Console で Google Calendar API を有効化します。
2. Google Auth Platform の OAuth 同意画面を設定します。
3. OAuth 2.0 クライアント ID を「ウェブ アプリケーション」で作成します。
4. Authorized JavaScript origins に `https://yoshimov.github.io` を追加します。
5. ローカル確認もする場合は、Authorized JavaScript origins に `http://localhost:4173` も追加します。
6. OAuth 同意画面の公開文書に、必要に応じて次の URL を設定します。
   - プライバシーポリシー: `https://yoshimov.github.io/instantdailymemo-pwa/privacy-policy.html`
   - 利用規約: `https://yoshimov.github.io/instantdailymemo-pwa/terms.html`
7. アプリの設定画面で「Google 接続」を押します。

既定では `primary` カレンダーに、今日の終日予定 `memo` として保存します。
OAuth クライアント ID はアプリに埋め込み済みです。

## GitHub Pages

このリポジトリはビルド不要の静的 PWA です。GitHub Pages では次の設定で公開できます。

1. GitHub のリポジトリ設定を開きます。
2. `Settings` -> `Pages` を開きます。
3. `Source` を `Deploy from a branch` にします。
4. `Branch` を `main`、フォルダを `/(root)` にします。
5. 保存後、`https://yoshimov.github.io/instantdailymemo-pwa/` で開きます。

## ローカル起動

Service Worker を使うため、ローカルサーバー経由で開きます。

```powershell
python -m http.server 4173
```

その後、ブラウザで `http://localhost:4173/` を開いてください。

## メモ

PWA は Android の Calendar Provider に直接アクセスできません。そのため、本文は IndexedDB にも保存し、Google Calendar API が接続済みのときだけ Calendar 側へ同期します。
