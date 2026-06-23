#!/bin/bash
# Starts Vite (port 3000) + Bun backend (port 3001), both auto-restarting.
exec 2>&1
cd /home/z/my-project

# backend watchdog
(
  while true; do
    cd /home/z/my-project/backend
    bun src/index.ts >> /home/z/my-project/backend/server.log 2>&1
    echo "[$(date)] backend exited ($?), restarting in 2s..." >> /home/z/my-project/backend/server.log
    sleep 2
  done
) &
echo "Backend watchdog started (PID $!)"

# Vite watchdog
(
  while true; do
    cd /home/z/my-project/frontend
    ./node_modules/.bin/vite --port 3000 --host 0.0.0.0 >> /home/z/my-project/frontend/vite.log 2>&1
    echo "[$(date)] vite exited ($?), restarting in 2s..." >> /home/z/my-project/frontend/vite.log
    sleep 2
  done
) &
echo "Vite watchdog started (PID $!)"

# wait for both
for i in $(seq 1 30); do
  v=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  b=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health 2>/dev/null)
  echo "[$i] vite=$v backend=$b"
  if [ "$v" = "200" ] && [ "$b" = "200" ]; then break; fi
  sleep 1
done
echo "Startup complete."
# Keep the script alive so background jobs aren't orphaned
wait
