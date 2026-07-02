import tls from "tls";

const socket = tls.connect(465, 'mail.my-nishinihon.com.my', { rejectUnauthorized: false }, () => {
  console.log('Connected');
  socket.write('EHLO localhost\r\n');
});

let output = '';
socket.on('data', (data) => {
  const str = data.toString();
  output += str;
  if (str.includes('250 ')) { // End of EHLO response usually has 250 (space) instead of 250-
    console.log(output);
    socket.write('QUIT\r\n');
  }
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});
