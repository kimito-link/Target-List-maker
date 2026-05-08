# 法人リスト URL+電話番号 収集ツール (Vercel版)

CSV から法人名・都道府県を読み込み、Claude API + web_search で各社の公式サイト URL と代表電話番号を自動収集する Web ツール。

## デプロイ手順 (kimito-link / Vercel)

### 1. GitHubリポジトリ作成

```bash
cd sales-list-tool
git init
git add .
git commit -m "Initial commit"
gh repo create kimito-link/sales-list-tool --private --source=. --push
# または GitHub Web UI で作成 → git remote add → git push
```

### 2. Vercel にインポート

1. https://vercel.com/kimito-link を開く
2. `Add New...` → `Project`
3. `sales-list-tool` リポジトリをインポート
4. Framework Preset: `Next.js` (自動検出されるはず)
5. **Environment Variables** に以下を追加:
   - `ANTHROPIC_API_KEY` = `sk-ant-...` (https://console.anthropic.com/settings/keys から取得)
   - `APP_PASSWORD` = 任意の文字列 (URL を知っているだけで使われないように。空にすると認証なし)
6. `Deploy` クリック

数分で `https://sales-list-tool-xxx.vercel.app` のような URL が発行されます。

### 3. (任意) カスタムドメイン

`sales.kimito.link` などにしたい場合、Vercel プロジェクトの `Settings → Domains` から追加。

## ローカル開発

```bash
cd sales-list-tool
npm install
cp .env.local.example .env.local
# .env.local を編集して ANTHROPIC_API_KEY を設定
npm run dev
# http://localhost:3000
```

## 使い方

1. URL にアクセス
2. (`APP_PASSWORD` を設定した場合) 画面上部の「パスワード」欄に入力
3. CSV (Shift-JIS or UTF-8 / 2列: 法人名,都道府県) をクリックでアップロード
4. 「処理件数」を選んで「実行」
5. 結果テーブルが埋まったら「ダウンロード」/「コピー」/「テキスト」で取り出し

## 構成

```
sales-list-tool/
├── app/
│   ├── api/lookup/route.ts   # Anthropic API プロキシ (サーバー側)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              # メインUI (Client Component)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.mjs
├── .env.local.example
├── .gitignore
└── README.md
```

主要ロジックは `app/api/lookup/route.ts` の **POST** に集約。プロンプト・JSON抽出・フォールバック正規表現はここで一元管理しています。

## コスト試算

- 1 件あたりの Claude API 課金 (Sonnet 4 + web_search): 約 **$0.05〜$0.15**
- 100 件: 約 $5〜15
- 1,000 件: 約 $50〜150
- 30,000 件: 約 **$1,500〜4,500**

3 万件規模の本番処理はこのツールではなく、別途用意した **Python 版 (DuckDuckGo 利用・無料)** を推奨します。
このVercel版は「精度検証・小ロット運用」用途。

## 想定パフォーマンス

- 1 件あたり 5〜15 秒 (web_search の挙動に依存)
- 100 件: 10〜25 分
- Vercel 関数の最大実行時間は 60 秒なので、1 リクエスト = 1 件処理の設計です

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `ANTHROPIC_API_KEY が未設定` | Vercel の Environment Variables で設定し、再デプロイ |
| `認証エラー` | パスワード欄に `APP_PASSWORD` の値を入力 |
| 60秒タイムアウト | Vercel Pro プラン以上で `maxDuration` を延長可 (現在 60秒設定) |
| 全件 URL 空欄 | API キーの権限・残高確認、ログを Vercel ダッシュボードで確認 |

## ライセンス

社内利用のみ。
