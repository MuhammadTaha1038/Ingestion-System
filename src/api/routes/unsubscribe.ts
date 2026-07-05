import { FastifyInstance } from "fastify";
import { getDatabasePool } from "../../db/pool.js";

export const registerUnsubscribeRoutes = (server: FastifyInstance) => {
  server.get("/unsubscribe", async (request, reply) => {
    const { email } = request.query as { email?: string };

    if (!email) {
      return reply.code(400).type("text/html").send("<html><body><h2>Missing email parameter.</h2></body></html>");
    }

    const pool = getDatabasePool();
    try {
      await pool.query(
        `INSERT INTO unsubscribes (email_normalized) VALUES ($1) ON CONFLICT DO NOTHING`,
        [email.toLowerCase().trim()]
      );

      return reply.code(200).type("text/html").send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>You have been successfully unsubscribed.</h2>
            <p>You will no longer receive emails from this sender.</p>
          </body>
        </html>
      `);
    } catch (err) {
      server.log.error(err);
      return reply.code(500).type("text/html").send("<html><body><h2>Internal server error.</h2></body></html>");
    }
  });
};
