import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "192.168.10.51",
  port: parseInt(process.env.DB_PORT ?? "3306"),
  user: process.env.DB_USER ?? "resmed",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "resmed_sleep",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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

export default pool;

