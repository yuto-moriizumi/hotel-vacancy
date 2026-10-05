#!/usr/bin/env bash
# WSL 実行用環境ラッパ。引数なしならツールチェックのみ。
export PATH="/home/volga/.nvm/versions/node/v24.21.0/bin:$PATH"
cd ~/hotel-vacancy || exit 1
if [ "$#" -gt 0 ]; then
  eval "$*"
else
  echo "node=$(node -v)"; echo "npm=$(npm -v)"; echo "os=$(uname -s)"
  node -e 'const {DatabaseSync}=require("node:sqlite"); const d=new DatabaseSync(":memory:"); d.exec("CREATE TABLE t(a)"); console.log("sqlite-ok");'
fi
