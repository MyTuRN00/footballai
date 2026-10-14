require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const path = require("path");
const multer = require("multer");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const ai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const port = process.env.PORT || 3000;

const defaultSettings = {
  registrationFee: Number(process.env.REGISTRATION_FEE_GHS || 50),
  customGhsPerCredit: Number(process.env.CUSTOM_GHS_PER_CREDIT || 5),
  packages: [
    { id: "starter", name: "Starter", credits: 10, price: 20 },
    { id: "plus", name: "Plus", credits: 30, price: 50 },
    { id: "pro", name: "Pro", credits: 75, price: 100 },
  ],
  analysisTypes: [
    { id: "quick", name: "Quick Match Outlook", cost: 1 },
    { id: "standard", name: "Full Match Analysis", cost: 2 },
    { id: "screenshot", name: "Screenshot / Odds Analysis", cost: 3 },
    { id: "tactical", name: "Tactical & Player Analysis", cost: 4 },
  ],
};

async function getSettings() {
  const q = await pool.query("SELECT value FROM app_settings WHERE key='pricing'");
  return q.rows[0]?.value || defaultSettings;
}

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 604800000,
    },
  })
);

const limiter = rateLimit({ windowMs: 900000, limit: 12, standardHeaders: true, legacyHeaders: false });
const imageTypes = ["image/png", "image/jpeg", "image/webp"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, imageTypes.includes(file.mimetype)),
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('user','admin')),
      registration_status TEXT NOT NULL DEFAULT 'payment_required' CHECK(registration_status IN('payment_required','registration_pending','approved','rejected','suspended')),
      credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_requests(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN('registration','credits')),
      package_id TEXT,
      amount_ghs NUMERIC(10,2) NOT NULL,
      payment_reference TEXT NOT NULL,
      proof_note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
      credits_to_add INTEGER NOT NULL DEFAULT 0,
      reviewed_by BIGINT REFERENCES users(id),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS proof_image BYTEA;
    ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS proof_mime TEXT;
    ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS proof_filename TEXT;

    CREATE TABLE IF NOT EXISTS analyses(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      result TEXT NOT NULL,
      credits_used INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings(
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query("INSERT INTO app_settings(key, value) VALUES('pricing', $1::jsonb) ON CONFLICT(key) DO NOTHING", [JSON.stringify(defaultSettings)]);

  if (adminEmail) {
    await pool.query("UPDATE users SET role='admin' WHERE lower(email) = $1", [adminEmail]);
  }
}

const pub = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  registration_status: u.registration_status,
  credits: u.credits,
});

async function getUser(req) {
  if (!req.session.userId) return null;
  const q = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
  return q.rows[0] || null;
}

async function userFlow(req, res, next) {
  try {
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: "Please sign in first." });
    if (u.registration_status === "suspended") return res.status(403).json({ error: "Account suspended." });
    req.user = u;
    next();
  } catch (e) {
    next(e);
  }
}

async function approved(req, res, next) {
  userFlow(req, res, () => {
    if (req.user.registration_status !== "approved" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Registration payment approval is required first." });
    }
    next();
  });
}

async function admin(req, res, next) {
  try {
    const u = await getUser(req);
    if (!u || u.role !== "admin") {
      return res.status(403).json({ error: "Admin access only." });
    }
    req.user = u;
    next();
  } catch (e) {
    next(e);
  }
}

app.get("/api/config", async (req, res, next) => {
  try {
    const s = await getSettings();
    res.json({
      currency: "GHS",
      registrationFee: s.registrationFee,
      momo: {
        method: "MTN Mobile Money",
        name: process.env.MOMO_PAYEE_NAME || "Set MOMO_PAYEE_NAME",
        number: process.env.MOMO_NUMBER || "Set MOMO_NUMBER",
        instructions: process.env.MOMO_INSTRUCTIONS || "Pay by MTN Mobile Money, then submit your transaction reference and proof screenshot. Never share your PIN.",
      },
      customGhsPerCredit: s.customGhsPerCredit,
      packages: s.packages,
      analysisTypes: s.analysisTypes,
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/me", async (req, res, next) => {
  try {
    const u = await getUser(req);
    res.json({ user: u ? pub(u) : null });
  } catch (e) {
    next(e);
  }
});

app.post("/api/register", limiter, async (req, res, next) => {
  try {
    let { name, email, password } = req.body || {};
    email = String(email || "").trim().toLowerCase();

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 10) {
      return res.status(400).json({ error: "Enter your name, valid email and password of at least 10 characters." });
    }

    const role = email === adminEmail && adminEmail ? "admin" : "user";
    const q = await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
      [String(name).trim().slice(0, 100), email, await bcrypt.hash(password, 12), role]
    );

    req.session.userId = q.rows[0].id;
    res.status(201).json({ user: pub(q.rows[0]), message: "Account created. Registration payment approval is required." });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email already registered. Sign in instead." });
    next(e);
  }
});

app.post("/api/login", limiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const q = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = q.rows[0];

    if (!user || !(await bcrypt.compare(String(req.body?.password || ""), user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }

    req.session.userId = user.id;
    res.json({ user: pub(user) });
  } catch (e) {
    next(e);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/dashboard", userFlow, async (req, res, next) => {
  try {
    const [p, a] = await Promise.all([
      pool.query(
        "SELECT id,kind,amount_ghs,payment_reference,status,credits_to_add,created_at FROM payment_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
        [req.user.id]
      ),
      pool.query(
        "SELECT id,analysis_type,prompt,result,credits_used,created_at FROM analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
        [req.user.id]
      ),
    ]);

    res.json({ user: pub(req.user), payments: p.rows, analyses: a.rows });
  } catch (e) {
    next(e);
  }
});

app.post("/api/payments", userFlow, upload.single("proof"), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const kind = req.body?.kind;
    const amount = Number(req.body?.amount);
    const ref = String(req.body?.payment_reference || "").trim();
    const note = String(req.body?.proof_note || "").slice(0, 500);

    if (!req.file) {
      return res.status(400).json({ error: "Upload a proof-of-payment screenshot (PNG, JPG or WEBP, maximum 5 MB)." });
    }

    if (!["registration", "credits"].includes(kind) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || ref.length < 3 || ref.length > 160) {
      return res.status(400).json({ error: "Enter a valid payment type, amount and transaction reference." });
    }

    if (kind === "registration" && Math.abs(amount - settings.registrationFee) > 0.001) {
      return res.status(400).json({ error: `Registration payment must be GH₵${Number(settings.registrationFee).toFixed(2)}.` });
    }

    if (kind === "registration" && req.user.registration_status === "approved") {
      return res.status(400).json({ error: "Registration already approved." });
    }

    if (kind === "credits" && req.user.registration_status !== "approved" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Registration approval is required before buying credits." });
    }

    let pkgId = null;
    let credits = 0;

    if (kind === "credits") {
      pkgId = String(req.body?.package_id || "");
      const p = settings.packages.find((x) => x.id === pkgId);

      if (p) {
        if (Math.abs(p.price - amount) > 0.001) {
          return res.status(400).json({ error: "Amount does not match package price." });
        }
        credits = p.credits;
      } else {
        if (!req.body?.custom_amount || amount < 5) {
          return res.status(400).json({ error: "Choose a package or enter a custom amount of at least GH₵5." });
        }
        credits = Math.floor(amount / settings.customGhsPerCredit);
        if (credits < 1) {
          return res.status(400).json({ error: "Custom amount is too low." });
        }
        pkgId = "custom";
      }
    }

    const pending = await pool.query(
      "SELECT id FROM payment_requests WHERE user_id=$1 AND kind=$2 AND status='pending'",
      [req.user.id, kind]
    );

    if (pending.rowCount) {
      return res.status(409).json({ error: "A payment request of this type is already pending review." });
    }

    await pool.query(
      "INSERT INTO payment_requests(user_id,kind,package_id,amount_ghs,payment_reference,proof_note,credits_to_add,proof_image,proof_mime,proof_filename) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        req.user.id,
        kind,
        pkgId,
        amount,
        ref,
        note,
        credits,
        req.file.buffer,
        req.file.mimetype,
        String(req.file.originalname || "payment-proof").slice(0, 200),
      ]
    );

    if (kind === "registration") {
      await pool.query("UPDATE users SET registration_status='registration_pending' WHERE id=$1", [req.user.id]);
    }

    res.status(201).json({
      message:
        kind === "registration"
          ? "Registration payment submitted. Awaiting separate admin approval."
          : `Credit payment submitted. ${credits} credits will be added only after approval.`,
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/admin", admin, async (req, res, next) => {
  try {
    const settings = await getSettings();
    const [u, p, s] = await Promise.all([
      pool.query("SELECT id,name,email,role,registration_status,credits,created_at FROM users ORDER BY created_at DESC LIMIT 300"),
      pool.query(
        "SELECT p.id,p.user_id,p.kind,p.package_id,p.amount_ghs,p.payment_reference,p.proof_note,p.proof_mime,p.proof_filename,p.status,p.credits_to_add,p.reviewed_by,p.reviewed_at,p.created_at,u.name,u.email FROM payment_requests p JOIN users u ON u.id=p.user_id ORDER BY (p.status='pending') DESC,p.created_at DESC LIMIT 100"
      ),
      pool.query("SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM payment_requests WHERE status='pending') pending, (SELECT count(*) FROM analyses) analyses"),
    ]);

    res.json({ users: u.rows, payments: p.rows, stats: s.rows[0], settings });
  } catch (e) {
    next(e);
  }
});

app.put("/api/admin/settings", admin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const registrationFee = Number(body.registrationFee);
    const customGhsPerCredit = Number(body.customGhsPerCredit);
    const packages = body.packages;
    const analysisTypes = body.analysisTypes;

    if (
      !Number.isFinite(registrationFee) ||
      registrationFee < 1 ||
      registrationFee > 1000000 ||
      !Number.isFinite(customGhsPerCredit) ||
      customGhsPerCredit < 0.01 ||
      customGhsPerCredit > 1000000 ||
      !Array.isArray(packages) ||
      packages.length < 1 ||
      packages.length > 10 ||
      !Array.isArray(analysisTypes) ||
      analysisTypes.length < 1 ||
      analysisTypes.length > 10
    ) {
      return res.status(400).json({ error: "Enter valid prices, conversion rate, packages and analysis costs." });
    }

    const ids = new Set();
    for (const p of packages) {
      if (
        !/^[a-z0-9_-]{1,30}$/.test(String(p.id)) ||
        ids.has(p.id) ||
        !String(p.name || "").trim() ||
        !Number.isInteger(Number(p.credits)) ||
        Number(p.credits) < 1 ||
        Number(p.credits) > 1000000 ||
        !Number.isFinite(Number(p.price)) ||
        Number(p.price) < 0.01 ||
        Number(p.price) > 1000000
      ) {
        return res.status(400).json({ error: "Each package needs a unique ID, name, positive whole credit amount and valid price." });
      }
      ids.add(p.id);
    }

    const typeIds = new Set();
    for (const t of analysisTypes) {
      if (
        !/^[a-z0-9_-]{1,30}$/.test(String(t.id)) ||
        typeIds.has(t.id) ||
        !String(t.name || "").trim() ||
        !Number.isInteger(Number(t.cost)) ||
        Number(t.cost) < 0 ||
        Number(t.cost) > 1000000
      ) {
        return res.status(400).json({ error: "Each analysis type needs a unique ID, name and non-negative whole-number credit cost." });
      }
      typeIds.add(t.id);
    }

    const value = {
      registrationFee,
      customGhsPerCredit,
      packages: packages.map((p) => ({
        id: String(p.id),
        name: String(p.name).trim().slice(0, 60),
        credits: Number(p.credits),
        price: Number(p.price),
      })),
      analysisTypes: analysisTypes.map((t) => ({
        id: String(t.id),
        name: String(t.name).trim().slice(0, 80),
        cost: Number(t.cost),
      })),
    };

    await pool.query(
      "INSERT INTO app_settings(key, value, updated_at) VALUES('pricing', $1::jsonb, NOW()) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
      [JSON.stringify(value)]
    );

    res.json({ message: "Pricing settings saved.", settings: value });
  } catch (e) {
    next(e);
  }
});

app.get("/api/admin/payments/:id/proof", admin, async (req, res, next) => {
  try {
    const q = await pool.query("SELECT proof_image,proof_mime FROM payment_requests WHERE id=$1", [req.params.id]);
    if (!q.rows[0] || !q.rows[0].proof_image) return res.status(404).send("Proof image not found.");
    res.set("Content-Type", q.rows[0].proof_mime || "application/octet-stream");
    res.set("Cache-Control", "private, no-store");
    res.send(q.rows[0].proof_image);
  } catch (e) {
    next(e);
  }
});

app.post("/api/admin/payments/:id/review", admin, async (req, res, next) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const q = await c.query("SELECT * FROM payment_requests WHERE id=$1 FOR UPDATE", [req.params.id]);
    const p = q.rows[0];
    const d = req.body?.decision;

    if (!p) {
      await c.query("ROLLBACK");
      return res.status(404).json({ error: "Payment not found." });
    }

    if (p.status !== "pending") {
      await c.query("ROLLBACK");
      return res.status(409).json({ error: "Already reviewed." });
    }

    if (!["approve", "reject"].includes(d)) {
      await c.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid decision." });
    }

    if (d === "approve") {
      if (p.kind === "registration") {
        await c.query("UPDATE users SET registration_status='approved' WHERE id=$1", [p.user_id]);
      } else {
        await c.query("UPDATE users SET credits=credits+$1 WHERE id=$2", [p.credits_to_add, p.user_id]);
      }
    } else if (p.kind === "registration") {
      await c.query("UPDATE users SET registration_status='rejected' WHERE id=$1", [p.user_id]);
    }

    await c.query("UPDATE payment_requests SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3", [d === "approve" ? "approved" : "rejected", req.user.id, p.id]);
    await c.query("COMMIT");

    res.json({
      message:
        d === "approve"
          ? p.kind === "registration"
            ? "Registration approved."
            : "Credits added after credit-payment approval."
          : "Payment rejected.",
    });
  } catch (e) {
    await c.query("ROLLBACK");
    next(e);
  } finally {
    c.release();
  }
});

app.post("/api/admin/users/:id/credits", admin, async (req, res, next) => {
  try {
    const n = Number(req.body?.delta);
    if (!Number.isInteger(n) || !n || Math.abs(n) > 1000000) {
      return res.status(400).json({ error: "Enter a valid non-zero whole-number adjustment." });
    }

    const q = await pool.query(
      "UPDATE users SET credits=credits+$1 WHERE id=$2 AND credits+$1>=0 RETURNING id,credits",
      [n, req.params.id]
    );

    if (!q.rows[0]) {
      return res.status(400).json({ error: "User not found or credits would become negative." });
    }

    res.json({ message: "Credits updated." });
  } catch (e) {
    next(e);
  }
});

app.get("/admin", admin, (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.post("/api/analyze", approved, upload.single("image"), async (req, res, next) => {
  const c = await pool.connect();
  try {
    const settings = await getSettings();
    const prompt = String(req.body?.prompt || "").trim().slice(0, 4000);
    const type = String(req.body?.analysis_type || "quick");
    const t = settings.analysisTypes.find((x) => x.id === type);

    if (!t) return res.status(400).json({ error: "Choose a valid analysis type." });
    if (!prompt && !req.file) return res.status(400).json({ error: "Enter a match request or upload a screenshot." });
    if (req.user.role !== "admin" && req.user.credits < t.cost) {
      return res.status(402).json({ error: `This analysis needs ${t.cost} credits. You have ${req.user.credits}.` });
    }
    if (!ai) {
      return res.status(503).json({ error: "AI service is not configured. Owner must set OPENAI_API_KEY. No credits were deducted." });
    }

    const content = [
      {
        type: "text",
        text: `You are FootballAI. Provide ${t.name}. Never invent current scores, injuries, lineups or stats. If live data was not supplied, clearly say the analysis is based only on user input/general reasoning. Separate known information from estimates; include uncertainties and note predictions are not guarantees. Request: ${prompt || "Analyze the supplied football screenshot."}`,
      },
    ];

    if (req.file) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}` },
      });
    }

    const out = await ai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content }],
      max_tokens: 1200,
    });

    const result = out.choices?.[0]?.message?.content || "No analysis returned.";

    await c.query("BEGIN");
    const lock = await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
    const u = lock.rows[0];

    if (u.registration_status !== "approved" && u.role !== "admin") {
      await c.query("ROLLBACK");
      return res.status(403).json({ error: "Account approval required." });
    }

    if (u.role !== "admin" && u.credits < t.cost) {
      await c.query("ROLLBACK");
      return res.status(402).json({ error: "Not enough credits. No credits deducted." });
    }

    if (u.role !== "admin") {
      await c.query("UPDATE users SET credits=credits-$1 WHERE id=$2", [t.cost, u.id]);
    }

    await c.query("INSERT INTO analyses(user_id,analysis_type,prompt,result,credits_used) VALUES($1,$2,$3,$4,$5)", [u.id, type, prompt || "Screenshot analysis", result, t.cost]);
    await c.query("COMMIT");

    const fresh = await pool.query("SELECT * FROM users WHERE id=$1", [u.id]);
    res.json({ result, user: pub(fresh.rows[0]), creditsUsed: t.cost });
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {}
    next(e);
  } finally {
    c.release();
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Upload one PNG, JPG or WEBP image up to 5 MB." });
  }
  res.status(500).json({ error: "Server error. Check server logs." });
});

init()
  .then(() => app.listen(port, () => console.log(`FootballAI running on port ${port}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
