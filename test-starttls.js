import net from "net";
import tls from "tls";

const socket = net.connect(587, 'mail.my-nishinihon.com.my', () => {
  console.log('Connected to 587');
  socket.write('EHLO localhost\r\n');
});

let state = 0;

socket.on('data', (data) => {
  const str = data.toString();
  console.log('S:', str);

  if (state === 0 && str.includes('250 ')) {
    state = 1;
    console.log('C: STARTTLS');
    socket.write('STARTTLS\r\n');
  } else if (state === 1 && str.includes('220 ')) {
    state = 2;
    console.log('Negotiating TLS...');
    const secureSocket = tls.connect({
      socket: socket,
      rejectUnauthorized: false
    }, () => {
      console.log('TLS negotiated!');
      console.log('C: EHLO localhost (secure)');
      secureSocket.write('EHLO localhost\r\n');
    });

    secureSocket.on('data', (sData) => {
      const sStr = sData.toString();
      console.log('S (secure):', sStr);
      if (sStr.includes('250 ')) {
        secureSocket.write('QUIT\r\n');
      }
    });
  }
});
