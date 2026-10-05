// Runs a real Postgres locally without Docker (data in .pgdata/).
// DATABASE_URL=postgres://blunder:blunder@localhost:5434/blunder
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const pg = new EmbeddedPostgres({
  databaseDir: ".pgdata",
  user: "blunder",
  password: "blunder",
  port: 5434,
  persistent: true,
});

const fresh = !existsSync(".pgdata/PG_VERSION");
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("blunder");
console.log("Postgres ready on postgres://blunder:blunder@localhost:5434/blunder (Ctrl+C to stop)");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
