#!/bin/sh
set -eu
cd /workspace
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
# Super Maudio World + Soulseek bridge (tools/serve.js binds 0.0.0.0:8080)
PORT=8080 HOST=0.0.0.0 node tools/serve.js >>/tmp/app-startup.log 2>&1 &
# Wait briefly for listen
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
    exit 0
  fi
  sleep 0.3
done
exit 0
