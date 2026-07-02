import tls from "tls";

const socket = tls.connect(465, 'charlie.centralmalaysia.com', { rejectUnauthorized: false }, () => {
  console.log('Connected');
  socket.write('EHLO vmi3336536.contaboserver.net\r\n');
});

let output = '';
socket.on('data', (data) => {
  const str = data.toString();
  output += str;
  if (str.includes('250 ')) {
    console.log(output);
    socket.write('QUIT\r\n');
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});
