require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { testConnection } = require('./src/config/db');
const { startReleaseExpiredHoldsJob } = require('./src/cron/releaseExpiredHolds.job');
const { startMarkNoShowReservationsJob } = require('./src/cron/markNoShowReservations.job');
const { initSocket } = require('./src/utils/socket');

const PORT = process.env.PORT || 3000;

async function start() {
  await testConnection();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(PORT, () => {
    console.log(` Server đang chạy tại http://localhost:${PORT}`);
  });
  startReleaseExpiredHoldsJob();
  startMarkNoShowReservationsJob();
}

start();