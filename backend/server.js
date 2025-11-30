/**
 * server.js
 * TrustScore AI backend (single-file)
 * - MySQL (mysql2/promise)
 * - Auth: bcrypt password hashing, JWT access + refresh tokens
 * - Sign up includes location + occupation
 * - Refresh token stored in DB (users.refresh_token)
 * - Protected endpoints: /trustscore/:userId and /chat
 * - Calls Python ML microservice at http://localhost:8000/analyze
 *
 * BEFORE RUN:
 *  - npm install express mysql2 axios bcryptjs jsonwebtoken body-parser cors
 *  - Create DB and tables (SQL snippet below)
 *  - Set secrets in the config block
 */

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

/* ====== CONFIG - EDIT BEFORE RUNNING ====== */
const CONFIG = {
  MYSQL: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },
  JWT: {
    ACCESS_SECRET: process.env.ACCESS_TOKEN_SECRET,
    REFRESH_SECRET: process.env.REFRESH_TOKEN_SECRET,
    ACCESS_EXPIRES_IN: "15m", // short-lived
    REFRESH_EXPIRES_IN: "7d"  // long-lived
  },
  ML_ENGINE_URL: "http://127.0.0.1:8000/analyze"
};
/* ========================================= */

const db = mysql.createPool({
  host: CONFIG.MYSQL.host,
  user: CONFIG.MYSQL.user,
  password: CONFIG.MYSQL.password,
  database: CONFIG.MYSQL.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/* -------------------
   Helper functions
   ------------------- */
function signAccessToken(payload) {
  return jwt.sign(payload, CONFIG.JWT.ACCESS_SECRET, { expiresIn: CONFIG.JWT.ACCESS_EXPIRES_IN });
}
function signRefreshToken(payload) {
  return jwt.sign(payload, CONFIG.JWT.REFRESH_SECRET, { expiresIn: CONFIG.JWT.REFRESH_EXPIRES_IN });
}

async function getUserByEmail(email) {
  const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [email]);
  return rows.length ? rows[0] : null;
}
async function getUserById(id) {
  const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [id]);
  return rows.length ? rows[0] : null;
}

/* -------------------
   Auth middleware
   ------------------- */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, CONFIG.JWT.ACCESS_SECRET);
    const user = await getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: "Invalid token - user not found" });
    req.user = { id: user.id, email: user.email, location: user.location, occupation: user.occupation };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* -------------------
   Routes: Auth
   ------------------- */

/**
 * POST /signup
 * Body: { name, email, password, location, occupation }
 * Returns: { accessToken, refreshToken, user: {id,email,name,location,occupation} }
 */
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, location, occupation } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password required" });

    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "User already exists" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const [result] = await db.execute(
      "INSERT INTO users (name, email, password_hash, location, occupation) VALUES (?, ?, ?, ?, ?)",
      [name || null, email, hash, location || null, occupation || null]
    );

    const userId = result.insertId;

    // generate tokens
    const accessToken = signAccessToken({ userId });
    const refreshToken = signRefreshToken({ userId });

    // store refresh token in DB
    await db.execute("UPDATE users SET refresh_token = ? WHERE id = ?", [refreshToken, userId]);

    res.json({
      user: { id: userId, email, name, location, occupation },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error("signup:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

/**
 * POST /login
 * Body: { email, password }
 * Returns: { accessToken, refreshToken, user }
 */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const accessToken = signAccessToken({ userId: user.id });
    const refreshToken = signRefreshToken({ userId: user.id });

    await db.execute("UPDATE users SET refresh_token = ? WHERE id = ?", [refreshToken, user.id]);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, location: user.location, occupation: user.occupation },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error("login:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /refresh
 * Body: { refreshToken }
 * Returns: { accessToken }
 */
app.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });

    // verify token signature
    let payload;
    try {
      payload = jwt.verify(refreshToken, CONFIG.JWT.REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = await getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.refresh_token || user.refresh_token !== refreshToken) {
      return res.status(401).json({ error: "Refresh token mismatch" });
    }

    // issue new access token (do not rotate refresh token here; optional)
    const newAccessToken = signAccessToken({ userId: user.id });
    res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error("refresh:", err);
    res.status(500).json({ error: "Token refresh failed" });
  }
});

/**
 * POST /logout
 * Body: { refreshToken }
 * Clears stored refresh token in DB
 */
app.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });

    let payload;
    try {
      payload = jwt.verify(refreshToken, CONFIG.JWT.REFRESH_SECRET);
    } catch (err) {
      return res.status(200).json({ message: "Logged out (token invalid)" }); // already invalid
    }

    await db.execute("UPDATE users SET refresh_token = NULL WHERE id = ?", [payload.userId]);
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("logout:", err);
    res.status(500).json({ error: "Logout failed" });
  }
});

/* -------------------
   Routes: Transactions & TrustScore (protected)
   ------------------- */

/*
 * GET /transactions/:userId
 * Public for demo but will fetch transaction list
 */
app.get("/transactions/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const [rows] = await db.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC", [userId]);
    res.json({ transactions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching transactions" });
  }
});

/**
 * GET /trustscore/:userId
 * Protected route - requires Authorization: Bearer <accessToken>
 * Server will:
 *   - fetch user metadata (location, occupation)
 *   - fetch transactions
 *   - call Python ML microservice with transactions + metadata
 *   - return ML result
 */
app.get("/trustscore/:userId", authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    // only allow the authenticated user to fetch their own trustscore (or add admin privileges)
    if (req.user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const [rows] = await db.execute("SELECT * FROM transactions WHERE user_id = ?", [userId]);
    const transactions = rows;

    if (transactions.length === 0) return res.json({ message: "No transaction data found" });

    const mlInput = {
      amounts: transactions.map(t => Number(t.amount)),
      types: transactions.map(t => t.type),
      descriptions: transactions.map(t => t.details || t.description || ""),
      timestamps: transactions.map(t => `${t.date} ${t.time}`),
      location: user.location || "",
      occupation: user.occupation || ""
    };

    const mlResponse = await axios.post(CONFIG.ML_ENGINE_URL, mlInput, { timeout: 10000 });
    const mlResult = mlResponse.data;

    res.json({
      success: true,
      trustScore: mlResult.trustScore,
      safeLoan: mlResult.safeLoan,
      income: mlResult.incomeStats,
      expenses: mlResult.expenseStats,
      anomalies: mlResult.anomalies,
      insights: mlResult.insights,
      totalTransactions: transactions.length
    });
  } catch (err) {
    console.error("trustscore:", err?.response?.data || err.message);
    res.status(500).json({ error: "TrustScore calculation failed" });
  }
});

/**
 * POST /chat
 * Protected - uses ML engine + DB to answer user questions conversationally (rule-based)
 * Body: { question, userId }
 */
app.post("/chat", authenticate, async (req, res) => {
  try {
    const { question, userId } = req.body;
    if (!question || !userId) return res.status(400).json({ error: "question and userId required" });

    if (req.user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    const user = await getUserById(userId);
    const [rows] = await db.execute("SELECT * FROM transactions WHERE user_id = ?", [userId]);
    const transactions = rows;
    if (transactions.length === 0) return res.json({ answer: "Not enough transaction data to analyze." });

    const mlInput = {
      amounts: transactions.map(t => Number(t.amount)),
      types: transactions.map(t => t.type),
      descriptions: transactions.map(t => t.details || t.description || ""),
      timestamps: transactions.map(t => `${t.date} ${t.time}`),
      location: user.location || "",
      occupation: user.occupation || ""
    };

    const mlResponse = await axios.post(CONFIG.ML_ENGINE_URL, mlInput, { timeout: 10000 });
    const ml = mlResponse.data;

    // simple rule-based conversation logic
    const q = question.toLowerCase();
    if (q.includes("loan") || q.includes("borrow")) {
      return res.json({ answer: `You can safely borrow ₹${Math.round(ml.safeLoan)}.` });
    }
    if (q.includes("trustscore") || q.includes("trust score") || q.includes("score")) {
      return res.json({ answer: `Your TrustScore is ${ml.trustScore}.` });
    }
    if (q.includes("income")) {
      return res.json({ answer: `Your average monthly income is ₹${Math.round(ml.incomeStats.monthly)}.` });
    }
    if (q.includes("expense")) {
      return res.json({ answer: `Your average monthly expenses are ₹${Math.round(ml.expenseStats.monthly)}.` });
    }
    if (q.includes("fraud") || q.includes("anomaly") || q.includes("suspicious")) {
      return res.json({ answer: `We found ${ml.anomalies.length} suspicious transaction(s).` });
    }

    // default
    return res.json({ answer: `I can help with TrustScore, safe loan estimation, and fraud checks. Try: "How much can I borrow?"` });
  } catch (err) {
    console.error("chat:", err?.response?.data || err.message);
    res.status(500).json({ error: "Chatbot processing failed" });
  }
});

/* -------------------
   Admin / utility endpoints (optional)
   ------------------- */

/**
 * POST /seed-user
 * Quick utility to create a test user (for local dev only)
 * Body: { name, email, password, location, occupation }
 */
app.post("/seed-user", async (req, res) => {
  try {
    const { name, email, password, location, occupation } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email & password required" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const [result] = await db.execute(
      "INSERT INTO users (name, email, password_hash, location, occupation) VALUES (?, ?, ?, ?, ?)",
      [name || null, email, hash, location || null, occupation || null]
    );
    res.json({ message: "User seeded", id: result.insertId });
  } catch (err) {
    console.error("seed-user:", err);
    res.status(500).json({ error: "Failed to seed user" });
  }
});

/* -------------------
   Start server
   ------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`TrustScore backend running on http://localhost:${PORT}`);
});
