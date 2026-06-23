#!/bin/bash
# Starts Vite (port 3000) + Bun backend (port 3001), both auto-restarting.
exec 2>&1
cd /home/z/my-project

# backend watchdog
start_backend() {
  cd /home/z/my-project/backend
  while true; do
    bun src/index.ts >> /home/z/my-project/backend/server.log 2>&1
    echo "[$(date)] backend exited, restarting in 2s..." >> /home/z/my-project/backend/server.log
    sleep 2
  done
}
setsid bash -c "$(declare -f start_backend); start_backend" </dev/null >/dev/null 2>&1 &
disown
echo "Backend watchdog started"

# Vite watchdog
start_vite() {
  cd /home/z/my-project/frontend
  while true; do
    ./node_modules/.bin/vite --port 3000 --host 0.0.0.0 >> /home/z/my-project/frontend/vite.log 2>&1
    echo "[$(date)] vite exited, restarting in 2s..." >> /home/z/my-project/frontend/vite.log
    sleep 2
  done
}
setsid bash -c "$(declare -f start_vite); start_vite" </dev/null >/dev/null 2>&1 &
disown
echo "Vite watchdog started"

# wait for both
for i in $(seq 1 30); do
  v=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  b=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health 2>/dev/null)
  echo "[$i] vite=$v backend=$b"
  if [ "$v" = "200" ] && [ "$b" = "200" ]; then break; fi
  sleep 1
done
echo "Startup complete."
