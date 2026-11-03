# data/

実際の備蓄データを置く場所。**このフォルダは、この README 以外 gitignore されている**（公開リポジトリに家の備蓄の中身を入れないため）。

- `initial-data.json`：初期投入の正本（`npm run seed:validate` / `seed:apply` で使う）
- `initial-data.csv`：人間向けの検算用一覧
- `checks/`：実データでしか確かめられない受け入れ条件のテスト（ローカル限定。Vitest・Playwright がこのフォルダを見つけたときだけ実行する）

自動テストと CI は、架空の見本データ `fixtures/sample-data.json` を使う。
