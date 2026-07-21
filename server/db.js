const { Pool } = require('pg');

const SCHEMA = 'app_260712_tosb';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = { pool, SCHEMA };
