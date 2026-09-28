#!/usr/bin/env bash
# MediaConvert.sh - Universal media conversion. Local and offline.

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

printf '\n┌─────────────────────────────────────────┐\n'
printf '│             MediaConvert.sh             │\n'
printf '│   Local. Private. Offline. Beautiful.   │\n'
printf '└─────────────────────────────────────────┘\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed. Please install Node.js first."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Error: FFmpeg is not installed. Please install FFmpeg and ensure it is in PATH."
  exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "Error: ffprobe is not installed. Please install the FFmpeg package that provides ffprobe."
  exit 1
fi

# First launch needs network access to download npm dependencies.
# After that, conversion itself is completely local and does not require a network connection.
if [ ! -d "node_modules" ]; then
  echo "Installing local dependencies (first run only)..."
  npm install --silent
fi

if [ ! -f "dist/index.html" ]; then
  echo "Building the local UI..."
  npm run build --silent
fi

PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
export PORT

cleanup() {
  printf '\nShutting down MediaConvert.sh safely...\n'
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf .tmp/* 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM EXIT

echo "Starting MediaConvert engine on port $PORT..."
node backend/server.js &
SERVER_PID=$!

URL="http://127.0.0.1:$PORT"

# Wait for the HTTP server rather than relying on a fixed sleep.
for _ in $(seq 1 30); do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Error: MediaConvert backend exited unexpectedly."
    exit 1
  fi
  sleep 0.1
done

if ! curl -fsS "$URL/api/health" >/dev/null 2>&1; then
  echo "Error: MediaConvert backend did not become ready."
  exit 1
fi

echo "Server ready at $URL"

if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v start >/dev/null 2>&1; then
  start "$URL"
else
  echo "Open your browser and navigate to: $URL"
fi

wait "$SERVER_PID"
