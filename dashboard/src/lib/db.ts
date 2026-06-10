import mysql from "mysql2/promise";

const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;

function createDbPool(): mysql.Pool {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required database environment variable(s): ${missing.join(", ")}. ` +
        `Refusing to start without explicit credentials — see deploy/resmed.env.example.`
    );
  }
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 100,
    timezone: "+00:00",
    // Cast DECIMAL/NEWDECIMAL to JS numbers instead of strings
    typeCast(field, next) {
      if (field.type === "DECIMAL" || field.type === "NEWDECIMAL") {
        const val = field.string();
        return val === null ? null : parseFloat(val);
      }
      return next();
    },
  });
}

// Lazy singleton behind a Proxy: env validation happens on first query at
// runtime, not at import time, so `next build` works without DB credentials.
let realPool: mysql.Pool | undefined;

const pool = new Proxy({} as mysql.Pool, {
  get(_target, prop, _receiver) {
    realPool ??= createDbPool();
    const value = Reflect.get(realPool, prop, realPool);
    return typeof value === "function" ? value.bind(realPool) : value;
  },
});

export default pool;
