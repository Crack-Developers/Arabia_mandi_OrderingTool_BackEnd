const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const http = require('http');
dotenv.config({ path: './.env' });

const token = jwt.sign({ userId: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

http.get({
  hostname: 'localhost',
  port: 5001,
  path: '/api/dashboard/dish-summary?filterType=day&date=2026-08-08',
  headers: { 'Authorization': `Bearer ${token}` }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('dish-summary:', data.substring(0, 1000)));
});

http.get({
  hostname: 'localhost',
  port: 5001,
  path: '/api/dashboard/stats?filterType=day&date=2026-08-08',
  headers: { 'Authorization': `Bearer ${token}` }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('stats:', data.substring(0, 1000)));
});
