import tls from "tls";

const socket = tls.connect(465, 'mail.my-nishinihon.com.my', () => {
  console.log('Connected');
  socket.write('EHLO localhost\r\n');
});

socket.on('data', (data) => {
  console.log(data.toString());
  if (data.toString().includes('250')) {
    socket.write('QUIT\r\n');
  }
});

socket.on('error', (err) => {
  console.error(err);
});

socket.on('end', () => {
  console.log('Disconnected');
});
