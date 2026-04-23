// ── auth.js — Gestión de usuarios en memoria ───────────────────────────────
// Los usuarios se definen en la variable de entorno USERS (JSON array).
// Los cambios de contraseña persisten en memoria hasta el próximo reinicio/deploy.
// Para hacerlos permanentes, actualizar el hash en la variable USERS de Railway.

const bcrypt = require('bcryptjs');

// Roles disponibles y secciones accesibles
const ROLE_SECTIONS = {
  admin:    ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion'],
  socio:    ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion'],
  gerencia: ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion'],
  staff:    ['dashboard', 'tabla', 'seguimiento'],
};

const ROLE_LABELS = {
  admin:    'Admin',
  socio:    'Socio',
  gerencia: 'Gerencia',
  staff:    'Staff',
};

const ROLE_CAN_REFRESH = {
  admin:    true,
  socio:    true,
  gerencia: true,
  staff:    false,
};

// ── Carga de usuarios ──────────────────────────────────────────────────────
let users = [];

function loadUsers() {
  const raw = process.env.USERS;
  if (!raw) {
    console.warn('[auth] ⚠️  Variable USERS no definida. No hay usuarios cargados.');
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('USERS debe ser un array JSON');
    users = parsed;
    console.log(`[auth] ✓ ${users.length} usuario(s) cargado(s).`);
  } catch (e) {
    console.error('[auth] Error parseando USERS:', e.message);
  }
}

loadUsers();

// ── Consultas ──────────────────────────────────────────────────────────────
function findByEmail(email) {
  if (!email) return null;
  return users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()) || null;
}

function findById(id) {
  if (!id) return null;
  return users.find(u => String(u.id) === String(id)) || null;
}

function listUsers() {
  return users.map(u => ({
    id:    u.id,
    name:  u.name,
    email: u.email,
    role:  u.role,
  }));
}

// ── Contraseñas ────────────────────────────────────────────────────────────
async function verifyPassword(user, plain) {
  if (!user || !plain) return false;
  return bcrypt.compare(plain, user.passwordHash);
}

async function changePassword(userId, newPassword) {
  const user = findById(userId);
  if (!user) return false;
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  return true;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

// ── Vista pública (sin hash) ───────────────────────────────────────────────
function publicUser(user) {
  if (!user) return null;
  return {
    id:       user.id,
    name:     user.name,
    email:    user.email,
    role:     user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    sections: ROLE_SECTIONS[user.role] || [],
    canRefresh: ROLE_CAN_REFRESH[user.role] ?? false,
  };
}

module.exports = {
  findByEmail,
  findById,
  listUsers,
  verifyPassword,
  changePassword,
  hashPassword,
  publicUser,
  ROLE_SECTIONS,
  ROLE_LABELS,
};
