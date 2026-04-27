const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex");
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "copafacil.json");
const CONFIGURED_DATA_FILE = process.env.DATA_FILE || DEFAULT_DATA_FILE;
let dataFile = CONFIGURED_DATA_FILE;
const PUBLIC_DIR = path.join(__dirname, "public");
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 2_000_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function defaultData() {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    tournament: {
      name: "Copa Facil",
      subtitle: "Resultados, calendario y clasificacion en tiempo real",
      season: String(now.getFullYear())
    },
    teams: [
      { id: "team-atlas", name: "Atlas FC", shortName: "ATL", color: "#2563eb" },
      { id: "team-norte", name: "Norte United", shortName: "NOR", color: "#16a34a" },
      { id: "team-rivera", name: "Rivera Club", shortName: "RIV", color: "#f97316" },
      { id: "team-valle", name: "Valle 7", shortName: "VAL", color: "#dc2626" }
    ],
    matches: [
      {
        id: "match-1",
        round: "Jornada 1",
        date: now.toISOString(),
        homeTeamId: "team-atlas",
        awayTeamId: "team-norte",
        homeScore: 2,
        awayScore: 1,
        status: "finished"
      },
      {
        id: "match-2",
        round: "Jornada 1",
        date: nextWeek.toISOString(),
        homeTeamId: "team-rivera",
        awayTeamId: "team-valle",
        homeScore: null,
        awayScore: null,
        status: "scheduled"
      }
    ],
    updatedAt: now.toISOString()
  };
}

function isPermissionError(error) {
  return ["EACCES", "EPERM", "EROFS"].includes(error && error.code);
}

function assertWritableDataPath(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const probeFile = path.join(dir, `.write-test-${process.pid}`);
  fs.writeFileSync(probeFile, "ok", "utf8");
  fs.unlinkSync(probeFile);
}

function selectDataFile() {
  try {
    assertWritableDataPath(CONFIGURED_DATA_FILE);
    dataFile = CONFIGURED_DATA_FILE;
    return;
  } catch (error) {
    if (CONFIGURED_DATA_FILE === DEFAULT_DATA_FILE || !isPermissionError(error)) {
      throw error;
    }
    console.warn(
      `No se puede escribir en DATA_FILE=${CONFIGURED_DATA_FILE}. ` +
        `Usando almacenamiento temporal en ${DEFAULT_DATA_FILE}. ` +
        "En Render, monta un Persistent Disk en /var/data para conservar datos."
    );
  }

  assertWritableDataPath(DEFAULT_DATA_FILE);
  dataFile = DEFAULT_DATA_FILE;
}

function ensureDataFile() {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    writeData(defaultData());
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(dataFile, "utf8");
  return JSON.parse(raw);
}

function writeData(data) {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const nextData = { ...data, updatedAt: new Date().toISOString() };
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(nextData, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, dataFile);
  return nextData;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("El cuerpo de la peticion es demasiado grande."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createAdminToken() {
  const payload = base64Url(
    JSON.stringify({
      sub: "admin",
      exp: Math.floor(Date.now() / 1000) + ONE_WEEK_SECONDS
    })
  );
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function verifyAdminToken(token) {
  if (!token || !token.includes(".")) {
    return false;
  }
  const [payload, signature] = token.split(".");
  if (!timingSafeEqual(signature, sign(payload))) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.sub === "admin" && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function isAdmin(req) {
  return verifyAdminToken(parseCookies(req).cf_admin);
}

function setAdminCookie(req, res, token) {
  const secure =
    process.env.NODE_ENV === "production" || req.headers["x-forwarded-proto"] === "https";
  const parts = [
    `cf_admin=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ONE_WEEK_SECONDS}`
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "cf_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function publicPayload(data) {
  return {
    tournament: data.tournament,
    teams: data.teams,
    matches: data.matches,
    standings: buildStandings(data),
    updatedAt: data.updatedAt
  };
}

function exportPayload(data) {
  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    tournament: data.tournament,
    teams: data.teams,
    matches: data.matches,
    updatedAt: data.updatedAt
  };
}

function buildStandings(data) {
  const table = new Map(
    data.teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        teamName: team.name,
        shortName: team.shortName,
        color: team.color,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0
      }
    ])
  );

  for (const match of data.matches) {
    if (
      match.status !== "finished" ||
      !Number.isInteger(match.homeScore) ||
      !Number.isInteger(match.awayScore)
    ) {
      continue;
    }
    const home = table.get(match.homeTeamId);
    const away = table.get(match.awayTeamId);
    if (!home || !away) {
      continue;
    }

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return Array.from(table.values())
    .map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.teamName.localeCompare(b.teamName, "es");
    });
}

function normalizeText(value, fallback, maxLength) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  const text = normalized || fallback;
  return text.slice(0, maxLength);
}

function normalizeColor(value, fallback = "#2563eb") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function normalizeScore(value) {
  if (value === null || value === "" || typeof value === "undefined") {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 99 ? number : null;
}

function normalizeStatus(value) {
  return ["scheduled", "live", "finished"].includes(value) ? value : "scheduled";
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function teamExists(data, id) {
  return data.teams.some((team) => team.id === id);
}

function normalizeTeam(input, existingId) {
  const name = normalizeText(input.name, "Nuevo equipo", 60);
  return {
    id: existingId || makeId("team"),
    name,
    shortName: normalizeText(input.shortName, name.slice(0, 3).toUpperCase(), 8).toUpperCase(),
    color: normalizeColor(input.color)
  };
}

function normalizeMatch(input, data, existingId) {
  const homeTeamId = String(input.homeTeamId || "");
  const awayTeamId = String(input.awayTeamId || "");
  if (!teamExists(data, homeTeamId) || !teamExists(data, awayTeamId)) {
    throw new Error("Selecciona dos equipos validos.");
  }
  if (homeTeamId === awayTeamId) {
    throw new Error("Un partido necesita dos equipos distintos.");
  }
  const status = normalizeStatus(input.status);
  const homeScore = normalizeScore(input.homeScore);
  const awayScore = normalizeScore(input.awayScore);
  return {
    id: existingId || makeId("match"),
    round: normalizeText(input.round, "Jornada", 40),
    date: input.date ? new Date(input.date).toISOString() : new Date().toISOString(),
    homeTeamId,
    awayTeamId,
    homeScore: status === "scheduled" ? null : homeScore,
    awayScore: status === "scheduled" ? null : awayScore,
    status
  };
}

function normalizeImportedId(value, prefix) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    return makeId(prefix);
  }
  return id;
}

function normalizeImportedData(input) {
  const source = input && input.data ? input.data : input;
  if (!source || typeof source !== "object") {
    throw new Error("El fichero JSON no tiene un formato valido.");
  }
  if (!Array.isArray(source.teams) || !Array.isArray(source.matches)) {
    throw new Error("El JSON debe incluir equipos y partidos.");
  }

  const tournamentSource = source.tournament || {};
  const tournament = {
    name: normalizeText(tournamentSource.name, "Copa Facil", 80),
    subtitle: normalizeText(
      tournamentSource.subtitle,
      "Resultados, calendario y clasificacion en tiempo real",
      120
    ),
    season: normalizeText(tournamentSource.season, String(new Date().getFullYear()), 20)
  };

  const seenTeams = new Set();
  const teams = source.teams.map((team) => {
    let id = normalizeImportedId(team.id, "team");
    while (seenTeams.has(id)) {
      id = makeId("team");
    }
    seenTeams.add(id);
    return {
      id,
      name: normalizeText(team.name, "Equipo", 60),
      shortName: normalizeText(team.shortName, String(team.name || "EQ").slice(0, 3), 8).toUpperCase(),
      color: normalizeColor(team.color)
    };
  });

  const teamIds = new Set(teams.map((team) => team.id));
  const seenMatches = new Set();
  const matches = [];
  for (const match of source.matches) {
    const homeTeamId = String(match.homeTeamId || "");
    const awayTeamId = String(match.awayTeamId || "");
    if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId) || homeTeamId === awayTeamId) {
      continue;
    }

    let id = normalizeImportedId(match.id, "match");
    while (seenMatches.has(id)) {
      id = makeId("match");
    }
    seenMatches.add(id);

    const status = normalizeStatus(match.status);
    const homeScore = normalizeScore(match.homeScore);
    const awayScore = normalizeScore(match.awayScore);
    const date = new Date(match.date);
    matches.push({
      id,
      round: normalizeText(match.round, "Jornada", 40),
      date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      homeTeamId,
      awayTeamId,
      homeScore: status === "scheduled" ? null : homeScore,
      awayScore: status === "scheduled" ? null : awayScore,
      status
    });
  }

  return {
    tournament,
    teams,
    matches,
    updatedAt: new Date().toISOString()
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/public") {
    sendJson(res, 200, publicPayload(readData()));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/session") {
    sendJson(res, 200, { authenticated: isAdmin(req), username: ADMIN_USER });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readRequestJson(req);
    const validUser = timingSafeEqual(body.username || "", ADMIN_USER);
    const validPassword = timingSafeEqual(body.password || "", ADMIN_PASSWORD);
    if (!validUser || !validPassword) {
      sendError(res, 401, "Usuario o contrasena incorrectos.");
      return;
    }
    setAdminCookie(req, res, createAdminToken());
    sendJson(res, 200, { authenticated: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    clearAdminCookie(res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (!url.pathname.startsWith("/api/admin/")) {
    sendError(res, 404, "Ruta no encontrada.");
    return;
  }

  if (!isAdmin(req)) {
    sendError(res, 401, "Inicia sesion como administrador.");
    return;
  }

  const data = readData();
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readRequestJson(req) : {};

  if (req.method === "GET" && url.pathname === "/api/admin/export") {
    sendJson(res, 200, exportPayload(data));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/import") {
    try {
      sendJson(res, 200, publicPayload(writeData(normalizeImportedData(body))));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/settings") {
    data.tournament = {
      name: normalizeText(body.name, data.tournament.name, 80),
      subtitle: normalizeText(body.subtitle, data.tournament.subtitle, 120),
      season: normalizeText(body.season, data.tournament.season, 20)
    };
    sendJson(res, 200, publicPayload(writeData(data)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/teams") {
    data.teams.push(normalizeTeam(body));
    sendJson(res, 201, publicPayload(writeData(data)));
    return;
  }

  const teamMatch = url.pathname.match(/^\/api\/admin\/teams\/([^/]+)$/);
  if (teamMatch) {
    const teamId = teamMatch[1];
    const index = data.teams.findIndex((team) => team.id === teamId);
    if (index === -1) {
      sendError(res, 404, "Equipo no encontrado.");
      return;
    }
    if (req.method === "PUT") {
      data.teams[index] = normalizeTeam(body, teamId);
      sendJson(res, 200, publicPayload(writeData(data)));
      return;
    }
    if (req.method === "DELETE") {
      const used = data.matches.some(
        (match) => match.homeTeamId === teamId || match.awayTeamId === teamId
      );
      if (used) {
        sendError(res, 409, "No puedes borrar un equipo con partidos asignados.");
        return;
      }
      data.teams.splice(index, 1);
      sendJson(res, 200, publicPayload(writeData(data)));
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/matches") {
    try {
      data.matches.push(normalizeMatch(body, data));
      sendJson(res, 201, publicPayload(writeData(data)));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  const matchMatch = url.pathname.match(/^\/api\/admin\/matches\/([^/]+)$/);
  if (matchMatch) {
    const matchId = matchMatch[1];
    const index = data.matches.findIndex((match) => match.id === matchId);
    if (index === -1) {
      sendError(res, 404, "Partido no encontrado.");
      return;
    }
    if (req.method === "PUT") {
      try {
        data.matches[index] = normalizeMatch(body, data, matchId);
        sendJson(res, 200, publicPayload(writeData(data)));
      } catch (error) {
        sendError(res, 400, error.message);
      }
      return;
    }
    if (req.method === "DELETE") {
      data.matches.splice(index, 1);
      sendJson(res, 200, publicPayload(writeData(data)));
      return;
    }
  }

  sendError(res, 404, "Ruta no encontrada.");
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (url.pathname !== "/") {
        serveStatic(req, res, new URL("/", `http://${req.headers.host}`));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const extension = path.extname(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extension] || "application/octet-stream",
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Error interno.");
  }
});

selectDataFile();
ensureDataFile();

server.listen(PORT, () => {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD no esta definido. Usando contrasena local: admin123");
  }
  console.log(`Datos guardados en ${dataFile}`);
  console.log(`Copa Facil disponible en http://localhost:${PORT}`);
});
