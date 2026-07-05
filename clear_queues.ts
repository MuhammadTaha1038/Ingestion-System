import "dotenv/config";
import { ingestionQueue, sendingQueue } from "./src/queue/queues.js";
import { getDatabasePool } from "./src/db/pool.js";

async function clearQueues() {
  console.log("Draining Redis queues...");
  try {
    await sendingQueue.obliterate({ force: true });
    console.log("Sending queue obliterated.");
  } catch (e) {
    console.log("Sending queue obliterate error (might already be empty):", e.message);
  }

  try {
    await ingestionQueue.obliterate({ force: true });
    console.log("Ingestion queue obliterated.");
  } catch (e) {
    console.log("Ingestion queue obliterate error (might already be empty):", e.message);
  }

  console.log("Marking active database jobs as cancelled...");
  const pool = getDatabasePool();
  try {
    await pool.query(`UPDATE jobs SET status = 'error', error = 'Cancelled manually' WHERE status IN ('pending', 'processing')`);
    await pool.query(`UPDATE campaigns SET status = 'draft' WHERE status = 'active'`);
    console.log("Jobs and campaigns updated in database.");
  } catch (err) {
    console.error("Database update error:", err);
  } finally {
    await pool.end();
    await ingestionQueue.close();
    await sendingQueue.close();
    console.log("Done!");
    process.exit(0);
  }
}

clearQueues();
