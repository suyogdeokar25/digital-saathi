'use strict';

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');

(async () => {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const password = await rl.question('Enter a new admin password (at least 14 characters): ');
    if (password.length < 14) {
      console.error('Password too short. Use at least 14 characters.');
      process.exitCode = 1;
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    console.log('\nCopy this hash into the ADMIN_PASSWORD_HASH environment variable. Do not commit it to GitHub:\n');
    console.log(hash);
  } finally {
    rl.close();
  }
})();
