# GitHub Push の認証セットアップ

「Authentication failed / No anonymous write access」は、GitHub への**書き込み認証がまだ済んでいない**ために起きます。
GitHub CLI（`gh`）は導入済みなので、**ログインだけ**浅井さんの手で行ってください（認証は代行できないため）。

## 導入済みの状態

| 項目 | 状態 |
|---|---|
| GitHub CLI | `gh 2.96.0` を `~/.local/bin/gh` にインストール済み（sudo 不要） |
| PATH | `~/.bash_profile` に `~/.local/bin` が既にあり、新しいターミナルでも `gh` が使える |
| 認証情報の保存先 | `git config --global credential.helper osxkeychain`（macOS キーチェーン。平文保存しない） |
| リポジトリ | `~/word-quest-run`、remote `origin` 設定済み、`ver2.0` ブランチにコミット済み |

## 手順1：ログイン（浅井さんが実行）

ターミナルで実行してください。

```bash
gh auth login --hostname github.com --git-protocol https --web
```

対話で聞かれたら次を選びます。

- What account do you want to log into? → **GitHub.com**
- Authenticate Git with your GitHub credentials? → **Yes**
- ワンタイムコードが表示される → コピーしてブラウザで認証

ブラウザが自動で開かない場合は、表示された URL（`https://github.com/login/device`）を開き、表示されたコードを入力します。

## 手順2：git を gh 連携にする（ログイン後、1回だけ）

```bash
gh auth setup-git
```

これで `git push` が gh の認証を使うようになります。

## 手順3：確認

```bash
gh auth status
```

`Logged in to github.com as <ユーザー名>` と出れば成功です。

## 手順4：Push

Ver2.0 のブランチを push します。

```bash
cd ~/word-quest-run && git push -u origin ver2.0
```

復旧用タグも送る場合：

```bash
cd ~/word-quest-run && git push origin v1.0-pre-ver2
```

完成形を確認して問題なければ `main` へ反映：

```bash
cd ~/word-quest-run && git checkout main && git merge --ff-only ver2.0 && git push -u origin main
```

## 補足

- `--web` 方式はトークンを手で貼らずに済み、認証情報は macOS キーチェーンに保存されます。
- トークンを直接使いたい場合は `gh auth login --with-token < token.txt` も可能ですが、トークンをファイルに残さない運用を推奨します。
- **force push は禁止**（この運用ルールを維持します）。
- リポジトリが private で権限不足の場合は、`gh auth refresh -h github.com -s repo` でスコープを追加してください。
