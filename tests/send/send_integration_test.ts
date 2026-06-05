import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { sendDirect } from "../../src/smtp/sendDirect.js";

const PORT = 2525;

const run = async () => {
  const received: any[] = [];

  const server = new SMTPServer({
    authOptional: true,
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          received.push(parsed);
          callback(null);
        })
        .catch((err) => callback(err));
    },
  });

  await new Promise<void>((res, rej) => server.listen(PORT, (err?: any) => (err ? rej(err) : res())));
  console.log("SMTP test server listening on", PORT);

  try {
    await sendDirect({ host: "127.0.0.1", port: PORT, secure: false, ignoreTLS: true }, "test@example.com", "Test Subject", "<p>hi</p>");

    // wait briefly for server to process
    await new Promise((r) => setTimeout(r, 500));

    if (received.length === 0) {
      console.error("No messages received by test SMTP server");
      process.exit(2);
    }

    const msg = received[0];
    console.log("Received message subject:", msg.subject);
    process.exit(0);
  } finally {
    server.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
