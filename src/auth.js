// ── auth.js — Gestión de usuarios con persistencia en archivo ─────────────
// Arranque: carga desde DATA_DIR/users.json; si no existe, semilla desde USERS env var.
// Toda mutación (crear, borrar, cambiar password, cambiar rol) escribe al archivo.

const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

// ── Roles ──────────────────────────────────────────────────────────────────
const ROLE_SECTIONS = {
  admin:    ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion', 'turnos'],
  socio:    ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion', 'turnos'],
  gerencia: ['dashboard', 'tabla', 'bcg', 'seguimiento', 'inflacion', 'turnos'],
  staff:    ['dashboard', 'tabla', 'seguimiento'],
};
const ROLE_LABELS = {
  admin: 'Admin', socio: 'Socio', gerencia: 'Gerencia', staff: 'Staff',
};
const ROLE_CAN_REFRESH = {
  admin: true, socio: true, gerencia: true, staff: false,
};
const VALID_ROLES = Object.keys(ROLE_LABELS);

// ── Persistencia ───────────────────────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

let users = [];

function saveUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.error('[auth] Error guardando usuarios:', e.message);
  }
}

function loadUsers() {
  // 1. Intentar desde archivo (Railway Volume o local)
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      console.log(`[auth] ✓ ${users.length} usuario(s) cargado(s) desde archivo.`);
      return;
    }
  } catch (e) {
    console.error('[auth] Error leyendo archivo de usuarios:', e.message);
  }

  // 2. Semilla desde USERS env var y guardar al archivo
  try {
    const raw = process.env.USERS;
    if (!raw) {
      console.warn('[auth] ⚠️  Variable USERS no definida y no hay archivo. Sin usuarios.');
      return;
    }
    users = JSON.parse(raw);
    console.log(`[auth] ✓ ${users.length} usuario(s) desde USERS env var → guardando en archivo.`);
    saveUsers();
  } catch (e) {
    console.error('[auth] Error parseando USERS env var:', e.message);
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
    id: u.id, name: u.name, email: u.email, role: u.role,
  }));
}

// ── Mutaciones ─────────────────────────────────────────────────────────────
async function createUser(name, email, role, password) {
  if (!name || !email || !role || !password)
    return { error: 'Todos los campos son requeridos' };
  if (!VALID_ROLES.includes(role))
    return { error: 'Rol inválido' };
  if (password.length < 6)
    return { error: 'La contraseña debe tener al menos 6 caracteres' };
  if (findByEmail(email))
    return { error: 'Ya existe un usuario con ese email' };

  const id           = String(Date.now());
  const passwordHash = await bcrypt.hash(password, 10);
  const user         = { id, name, email: email.toLowerCase().trim(), passwordHash, role };
  users.push(user);
  saveUsers();
  return { ok: true, user: publicUser(user) };
}

function deleteUser(id) {
  const idx = users.findIndex(u => String(u.id) === String(id));
  if (idx < 0) return false;
  users.splice(idx, 1);
  saveUsers();
  return true;
}

function updateUserRole(id, role) {
  if (!VALID_ROLES.includes(role)) return false;
  const user = findById(id);
  if (!user) return false;
  user.role = role;
  saveUsers();
  return true;
}

async function verifyPassword(user, plain) {
  if (!user || !plain) return false;
  return bcrypt.compare(plain, user.passwordHash);
}

async function changePassword(userId, newPassword) {
  const user = findById(userId);
  if (!user) return false;
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers();
  return true;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

// ── Vista pública ──────────────────────────────────────────────────────────
function publicUser(user) {
  if (!user) return null;
  return {
    id:         user.id,
    name:       user.name,
    email:      user.email,
    role:       user.role,
    roleLabel:  ROLE_LABELS[user.role] || user.role,
    sections:   ROLE_SECTIONS[user.role] || [],
    canRefresh: ROLE_CAN_REFRESH[user.role] ?? false,
  };
}

module.exports = {
  findByEmail, findById, listUsers,
  createUser, deleteUser, updateUserRole,
  verifyPassword, changePassword, hashPassword,
  publicUser, VALID_ROLES, ROLE_LABELS,
};
