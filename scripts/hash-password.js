#!/usr/bin/env node
// ── Genera el hash bcrypt para una contraseña ──────────────────────────────
// Uso: node scripts/hash-password.js MiContraseña123
//
// El hash generado va en el campo "passwordHash" de la variable USERS.

const bcrypt = require('bcryptjs');

const plain = process.argv[2];
if (!plain) {
  console.error('Uso: node scripts/hash-password.js <contraseña>');
  process.exit(1);
}

bcrypt.hash(plain, 10).then(hash => {
  console.log('\nHash generado:');
  console.log(hash);
  console.log('\nUsalo en USERS así:');
  console.log(`  "passwordHash": "${hash}"`);
});
