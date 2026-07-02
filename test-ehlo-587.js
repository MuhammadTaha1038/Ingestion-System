import tls from "tls";
import net from "net";

const socket = net.connect(587, 'mail.my-nishinihon.com.my', () => {
  console.log('Connected to 587');
  socket.write('EHLO localhost\r\n');
});

let output = '';
socket.on('data', (data) => {
  const str = data.toString();
  output += str;
  console.log(str);
  if (str.includes('250 ')) {
    socket.write('QUIT\r\n');
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});
