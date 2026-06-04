import Fastify, { FastifyInstance } from "fastify";
import { Logger } from "../logging/logger.js";
import { registerRoutes } from "./routes/index.js";

export const createServer = (logger: Logger): FastifyInstance => {
  const server = Fastify({ logger: false });

  server.setErrorHandler((error, _request, reply) => {
    logger.error("api error", { message: error.message });
    reply.code(500).send({ error: "internal_error" });
  });

  registerRoutes(server);
  return server;
};
