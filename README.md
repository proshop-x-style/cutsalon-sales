# サロン売上・経費ダッシュボード

日次入力から月次・年次・累計までをまとめて管理できるアプリです。

## Webで起動

1. npm run dev
2. ブラウザで http://localhost:3000 を開く

## デスクトップアプリとして起動

1. npm run desktop:dev
2. Next.js起動後にElectronウィンドウが開きます

補足:
- npm run desktop:open は既にローカルでWebサーバーが起動中のときに使います。
- デスクトップ版は通常アプリのような独立ウィンドウで使えます。

## Windows向け .exe を作成

1. npm run desktop:dist
2. 生成物は dist/ または dist-installer/ に作られます

補足:
- まず軽量確認したい場合は npm run desktop:pack を使うと展開形式で出力されます。
- 初回は時間がかかることがあります。
- すぐ実行する場合は dist/win-unpacked/Salon Ledger.exe を起動できます。
- 単一の実行ファイルを出したい場合は npm run desktop:portable を使います。
- Setup形式が生成されない環境でも、win-unpacked は通常アプリとしてそのまま利用できます。
- win-unpacked が使用中で失敗する場合は、起動中のアプリを閉じて npm run desktop:clean を実行してから再ビルドしてください。
- 代表的な出力例: dist/Salon Ledger Setup 0.1.0.exe

## 署名付き配布（任意）

1. .env へ CSC_LINK と CSC_KEY_PASSWORD を設定
2. npm run desktop:dist を実行

補足:
- 未設定でもローカル配布は可能です。
- 署名設定をすると、配布時の警告を減らせます。

## 検証コマンド

1. npm run test
2. npm run typecheck
3. npm run build

## 許可ポップアップを減らす

Copilot Chat でコマンド実行確認が多い場合は、チャット下部の Default permissions から以下を Allow に設定します。

1. Terminal command
2. Dependency install
