'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const { error } = require('node:console');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!DATABASE_URL) {
  console.error('Startup blocked: DATABASE_URL is missing. Configure a PostgreSQL connection string.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Startup blocked: SESSION_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}
if (!ADMIN_PASSWORD_HASH || !/^\$2[aby]\$\d\d\$/.test(ADMIN_PASSWORD_HASH)) {
  console.error('Startup blocked: ADMIN_PASSWORD_HASH must contain a bcrypt password hash. Run: npm run hash-password');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});
pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error.message));

app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube-nocookie.com'],
      mediaSrc: ["'self'", 'https:'],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_PRODUCTION ? { maxAge: 15552000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(express.json({ limit: '20kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

const sessionStore = new PgSession({
  pool,
  tableName: 'digital_saathi_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 15 * 60
});

app.use(session({
  name: 'digital_saathi.sid',
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: 'index.html',
  maxAge: IS_PRODUCTION ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

let databaseInitialization;

app.use('/api', async (req, res, next) =>{
  try {
    if (!databaseInitialization) {
      databaseInitialization = 
    initializeDatabase();
      }

      await databaseInitialization;
      next();
  } catch (error0){
    databaseInitialization = undefined;
    next(error);
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts from this connection. Please try again later.' }
});

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if ((origin && origin !== expectedOrigin) || (!origin && fetchSite !== 'same-origin')) {
    return res.status(403).json({ error: 'Request origin could not be verified. Refresh the page and try again.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.isAdmin !== true) {
    return res.status(401).json({ error: 'Please sign in as admin first.' });
  }
  next();
}

function cleanText(value, maxLength, fieldName, { required = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be text.`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new Error(`${fieldName} is required.`);
  if (cleaned.length > maxLength) throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  return cleaned;
}

function parseVideoUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTPS video URL.');
  }
  if (value.length > 2048 || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Only secure HTTPS video links are allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
  const isYoutube = youtubeHosts.has(host);
  const isMp4 = /\.mp4$/i.test(parsed.pathname);
  if (!isYoutube && !isMp4) {
    throw new Error('Use a YouTube link or a direct HTTPS link ending in .mp4.');
  }
  return parsed.href;
}

async function initializeDatabase() {
  const schema = fs.readFileSync(
    path.join(__dirname, 'db', 'schema.sql'),
    'utf8'
  );

  await pool.query(schema);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Prevent multiple Vercel instances from seeding simultaneously
    await client.query('SELECT pg_advisory_xact_lock(741852963)');

    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS count FROM lessons'
    );

    if (rows[0].count === 0) {
      const lessons = [
        ['Learn your smartphone', 'Smartphone Basics', 'Get comfortable with the most useful phone controls.', '1. Press the side button to wake your phone.\n2. Swipe up or enter your PIN to unlock it.\n3. Tap an app once to open it.\n4. Use the Back button or gesture to return.\n5. Adjust volume with the side buttons.', '📱'],

        ['Make a phone call', 'Smartphone Basics', 'Learn how to call a family member or a trusted contact.', '1. Open the Phone app.\n2. Tap Contacts or the keypad.\n3. Select a contact or enter the number.\n4. Tap the green call button.\n5. Tap the red button to end the call.', '☎️'],

        ['Use WhatsApp', 'WhatsApp', 'Send messages and make calls to people you know.', '1. Open WhatsApp.\n2. Choose a contact you know.\n3. Type your message in the box.\n4. Tap Send.\n5. For a call, open the chat and tap the phone or video icon.', '💬'],

        ['Make a UPI payment safely', 'Digital Payments', 'Understand safe habits before paying by UPI.', '1. Open your trusted bank or UPI app.\n2. Check the recipient name carefully.\n3. Enter the amount yourself.\n4. Review the details before approving.\n5. Never share your UPI PIN or OTP. You do not need a PIN to receive money.', '💳'],

        ['Spot online scams', 'Online Safety', 'Recognise common tricks used by scammers.', '1. Be suspicious of urgent threats or prize messages.\n2. Never share OTPs, PINs, or passwords.\n3. Do not install screen-sharing apps for unknown callers.\n4. Do not click unexpected links.\n5. Call your bank using its official number if you are worried.', '🛡️'],

        ['Browse the internet', 'Internet Basics', 'Learn simple, safer web browsing.', '1. Open Chrome or another browser.\n2. Tap the address/search bar.\n3. Type what you want to find.\n4. Prefer official websites for banking or government services.\n5. Avoid entering personal details on unfamiliar websites.', '🌐']
      ];

      for (const lesson of lessons) {
        await client.query(
          `INSERT INTO lessons
          (title, category, description, steps, icon)
          VALUES ($1, $2, $3, $4, $5)`,
          lesson
        );
      }
    }

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.get('/api/lessons', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, title, category, description, steps, icon FROM lessons ORDER BY id');
    res.set('Cache-Control', 'public, max-age=300');
    res.json(rows);
  } catch (error) { next(error); }
});

app.get('/api/videos', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, category, description, video_url, created_at FROM videos ORDER BY id DESC'
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/learners', registrationLimiter, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name, 100, 'Full name', { required: true });
    const phone = cleanText(req.body.phone || '', 20, 'Phone number');
    const location = cleanText(req.body.location || '', 120, 'Location');
    const learningGoal = cleanText(req.body.learning_goal || '', 120, 'Learning goal');
    const experience = cleanText(req.body.experience || 'Beginner', 30, 'Experience');
    const allowedExperience = new Set(['Beginner', 'Some experience', 'Comfortable']);
    if (!allowedExperience.has(experience)) return res.status(400).json({ error: 'Please choose a valid experience level.' });
    if (phone && !/^[0-9+()\s.-]{7,20}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number or leave it blank.' });
    }
    let age = null;
    if (req.body.age !== undefined && req.body.age !== '') {
      age = Number(req.body.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        return res.status(400).json({ error: 'Age must be a whole number between 1 and 120.' });
      }
    }
    if (req.body.privacy_consent !== true) {
      return res.status(400).json({ error: 'Please confirm that you have read the privacy notice.' });
    }
    const result = await pool.query(
      `INSERT INTO learners
        (full_name, age, phone, location, learning_goal, experience, privacy_consent, privacy_consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW()) RETURNING id`,
      [fullName, age, phone, location, learningGoal, experience]
    );
    res.status(201).json({ message: 'Learner details saved successfully!', id: result.rows[0].id });
  } catch (error) {
    if (error instanceof Error && /must be|required|characters or fewer/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.post('/api/admin/login', requireSameOrigin, loginLimiter, async (req, res, next) => {
  try {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const matches = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!matches) return res.status(401).json({ error: 'Incorrect password. Please try again.' });

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    req.session.isAdmin = true;
    await new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
    res.json({ message: 'Signed in successfully.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/logout', requireSameOrigin, requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('digital_saathi.sid', {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'strict',
      path: '/'
    });
    res.json({ message: 'Signed out.' });
  });
});

app.get('/api/admin/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ loggedIn: req.session?.isAdmin === true });
});

app.get('/api/admin/learners', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, age, phone, location, learning_goal, experience, privacy_consent, created_at
       FROM learners ORDER BY id DESC LIMIT 5000`
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (error) { next(error); }
});

app.delete('/api/admin/learners/:id', requireSameOrigin, requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid learner ID.' });
  try {
    const result = await pool.query('DELETE FROM learners WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Learner not found.' });
    res.json({ message: 'Learner record deleted.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/videos', requireSameOrigin, requireAdmin, async (req, res, next) => {
  try {
    const title = cleanText(req.body.title || '', 120, 'Video title', { required: true });
    const category = cleanText(req.body.category || 'General', 80, 'Category');
    const description = cleanText(req.body.description || '', 500, 'Description');
    const videoUrl = parseVideoUrl(typeof req.body.video_url === 'string' ? req.body.video_url.trim() : '');
    const result = await pool.query(
      `INSERT INTO videos (title, category, description, video_url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [title, category || 'General', description, videoUrl]
    );
    res.status(201).json({ message: 'Video added to the learning page.', id: result.rows[0].id });
  } catch (error) {
    if (error instanceof Error && /must be|required|characters or fewer|HTTPS|YouTube|secure/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.delete('/api/admin/videos/:id', requireSameOrigin, requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid video ID.' });
  try {
    const result = await pool.query('DELETE FROM videos WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Video not found.' });
    res.json({ message: 'Video removed.' });
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Something went wrong. Please try again later.' });
});

if(require.main === module) {
  app.listen(PORT, () =>{
    console.log('Digital Saathi is listening on port ${PORT}');
  });
}

module.exports = app