cd "/opt/ingestion-system"
git reset --hard HEAD
git clean -fd
git pull
npm run build
pm2 restart ingestion-bot || (export $(grep -v "^#" .env | xargs) && setsid nohup node dist/main.js > /var/log/ingestion-bot.log 2>&1 &)
