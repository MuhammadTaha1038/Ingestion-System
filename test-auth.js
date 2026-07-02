import tls from "tls";

const socket = tls.connect(465, 'mail.my-nishinihon.com.my', { rejectUnauthorized: false }, () => {
  console.log('Connected');
  socket.write('EHLO localhost\r\n');
});

let state = 0;
let output = '';

socket.on('data', (data) => {
  const str = data.toString();
  output += str;
  console.log('S:', str);
  
  if (state === 0 && str.includes('250 ')) {
    state = 1;
    console.log('C: AUTH LOGIN');
    socket.write('AUTH LOGIN\r\n');
  } else if (state === 1 && str.includes('334 ')) {
    console.log('Server accepted AUTH LOGIN! Waiting for base64 username...');
    state = 2;
    socket.write('QUIT\r\n');
  } else if (state === 1 && str.match(/^[45]/)) {
    console.log('Server REJECTED AUTH LOGIN.');
    socket.write('QUIT\r\n');
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});
