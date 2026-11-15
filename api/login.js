
const crypto = require("crypto");
const admin = require("firebase-admin");

let db;

function getDB() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }

  if (!db) db = admin.database();
  return db;
}

function makeToken(uid) {
  const payload = Buffer.from(JSON.stringify({
    uid,
    exp: Math.floor(Date.now() / 1000) + 86400
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", process.env.VYROVA_SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  return payload + "." + signature;
}

function verifyPassword(password) {
  return crypto
    .createHash("sha256")
    .update("pf:" + password)
    .digest("hex");
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        !process.env.FIREBASE_DATABASE_URL ||
        !process.env.VYROVA_SESSION_SECRET) {
      return res.status(500).json({ error: "Server configuration missing" });
    }

    const { email, password } = req.body || {};

    if (typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password ||
        password.length > 200) {
      return res.status(400).json({ error: "Invalid login details" });
    }

    const database = getDB();
    const snapshot = await database.ref("users").once("value");
    const users = snapshot.val() || {};

    const identifier = email.trim().toLowerCase();

    const match = Object.entries(users).find(([id, user]) =>
      user &&
      (String(user.email || "").toLowerCase() === identifier ||
       String(user.username || "").toLowerCase() === identifier)
    );

    if (!match) {
      return res.status(401).json({ error: "Invalid username/email or password" });
    }

    const [uid, user] = match;
    const stored = String(user.pw || "");
    const supplied = verifyPassword(password);

    const valid =
      /^[a-f0-9]{64}$/i.test(stored) &&
      crypto.timingSafeEqual(
        Buffer.from(stored, "hex"),
        Buffer.from(supplied, "hex")
      );

    if (!valid || user.banned) {
      return res.status(401).json({ error: "Invalid username/email or password" });
    }

    const token = makeToken(uid);

    res.setHeader("Set-Cookie",
      `vyrova_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
    );

    return res.status(200).json({
      success: true,
      user: {
        id: uid,
        name: user.name || "",
        username: user.username || "",
        email: user.email || "",
        role: user.role || "user"
      }
    });

  } catch (error) {
    console.error("Login API error:", error.message);
    return res.status(500).json({ error: "Login service unavailable" });
  }
};
    
