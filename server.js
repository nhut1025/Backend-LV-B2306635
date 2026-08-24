
require('dotenv').config();
const app = require('./src/app');
const { testConnection } = require('./src/config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  await testConnection(); 
  app.listen(PORT, () => {
    console.log(` Server đang chạy tại http://localhost:${PORT}`);
  });
}

start();
