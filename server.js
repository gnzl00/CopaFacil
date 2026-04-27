const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { createStore } = require("./storage");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex");
const PUBLIC_DIR = path.join(__dirname, "public");
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 8_000_000;
const MAX_LOGO_DATA_URL_LENGTH = 70_000;
let store;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultTournament() {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const season = `${now.getFullYear()}-${now.getFullYear() + 1}`;
  return {
    id: `season-${season}`,
    name: "Copa Facil",
    subtitle: "Resultados, calendario y clasificacion en tiempo real",
    season,
    teams: [
      { id: "team-atlas", name: "Atlas FC", shortName: "ATL", logoDataUrl: "" },
      { id: "team-norte", name: "Norte United", shortName: "NOR", logoDataUrl: "" },
      { id: "team-rivera", name: "Rivera Club", shortName: "RIV", logoDataUrl: "" },
      { id: "team-valle", name: "Valle 7", shortName: "VAL", logoDataUrl: "" }
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
        status: "finished",
        goals: [
          { id: makeId("goal"), teamId: "team-atlas", playerName: "Jugador Atlas", assistName: "" },
          { id: makeId("goal"), teamId: "team-atlas", playerName: "Jugador Atlas", assistName: "" },
          { id: makeId("goal"), teamId: "team-norte", playerName: "Jugador Norte", assistName: "" }
        ],
        cards: [],
        mvp: { teamId: "team-atlas", playerName: "Jugador Atlas" }
      },
      {
        id: "match-2",
        round: "Jornada 1",
        date: nextWeek.toISOString(),
        homeTeamId: "team-rivera",
        awayTeamId: "team-valle",
        homeScore: null,
        awayScore: null,
        status: "scheduled",
        goals: [],
        cards: [],
        mvp: null
      }
    ]
  };
}

function defaultData() {
  const tournament = defaultTournament();
  return {
    schemaVersion: 2,
    activeTournamentId: tournament.id,
    tournaments: [tournament],
    updatedAt: new Date().toISOString()
  };
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

function normalizeText(value, fallback, maxLength) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  const text = normalized || fallback;
  return text.slice(0, maxLength);
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

function normalizeCardType(value) {
  return value === "red" ? "red" : "yellow";
}

function normalizeImportedId(value, prefix) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    return makeId(prefix);
  }
  return id;
}

function normalizeLogoDataUrl(value) {
  const logo = String(value || "").trim();
  if (!logo) {
    return "";
  }
  if (logo.length > MAX_LOGO_DATA_URL_LENGTH) {
    return "";
  }
  return /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(logo) ? logo : "";
}

function normalizeTeam(input, existingId) {
  const name = normalizeText(input.name, "Nuevo equipo", 60);
  return {
    id: existingId || normalizeImportedId(input.id, "team"),
    name,
    shortName: normalizeText(input.shortName, name.slice(0, 3).toUpperCase(), 8).toUpperCase(),
    logoDataUrl: normalizeLogoDataUrl(input.logoDataUrl)
  };
}

function normalizeGoal(input, tournament) {
  const teamId = String(input.teamId || "");
  if (!teamExists(tournament, teamId)) {
    return null;
  }
  const playerName = normalizeText(input.playerName, "", 80);
  if (!playerName) {
    return null;
  }
  return {
    id: normalizeImportedId(input.id, "goal"),
    teamId,
    playerName,
    assistName: normalizeText(input.assistName, "", 80)
  };
}

function normalizeCard(input, tournament) {
  const teamId = String(input.teamId || "");
  if (!teamExists(tournament, teamId)) {
    return null;
  }
  const playerName = normalizeText(input.playerName, "", 80);
  if (!playerName) {
    return null;
  }
  return {
    id: normalizeImportedId(input.id, "card"),
    teamId,
    playerName,
    type: normalizeCardType(input.type)
  };
}

function normalizeMvp(input, tournament) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const teamId = String(input.teamId || "");
  const playerName = normalizeText(input.playerName, "", 80);
  if (!teamExists(tournament, teamId) || !playerName) {
    return null;
  }
  return { teamId, playerName };
}

function normalizeMatch(input, tournament, existingId) {
  const homeTeamId = String(input.homeTeamId || "");
  const awayTeamId = String(input.awayTeamId || "");
  if (!teamExists(tournament, homeTeamId) || !teamExists(tournament, awayTeamId)) {
    throw new Error("Selecciona dos equipos validos.");
  }
  if (homeTeamId === awayTeamId) {
    throw new Error("Un partido necesita dos equipos distintos.");
  }
  const status = normalizeStatus(input.status);
  const homeScore = normalizeScore(input.homeScore);
  const awayScore = normalizeScore(input.awayScore);
  const date = new Date(input.date || Date.now());
  return {
    id: existingId || normalizeImportedId(input.id, "match"),
    round: normalizeText(input.round, "Jornada", 40),
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    homeTeamId,
    awayTeamId,
    homeScore: status === "scheduled" ? null : homeScore,
    awayScore: status === "scheduled" ? null : awayScore,
    status,
    goals: Array.isArray(input.goals)
      ? input.goals.map((goal) => normalizeGoal(goal, tournament)).filter(Boolean)
      : [],
    cards: Array.isArray(input.cards)
      ? input.cards.map((card) => normalizeCard(card, tournament)).filter(Boolean)
      : [],
    mvp: normalizeMvp(input.mvp, tournament)
  };
}

function normalizeTournament(input, existingId) {
  const season = normalizeText(input.season, `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`, 20);
  const tournament = {
    id: existingId || normalizeImportedId(input.id || `season-${season}`, "season"),
    name: normalizeText(input.name, "Copa Facil", 80),
    subtitle: normalizeText(input.subtitle, "Resultados, calendario y clasificacion", 120),
    season,
    teams: [],
    matches: []
  };

  const seenTeams = new Set();
  tournament.teams = Array.isArray(input.teams)
    ? input.teams.map((team) => {
        let id = normalizeImportedId(team.id, "team");
        while (seenTeams.has(id)) {
          id = makeId("team");
        }
        seenTeams.add(id);
        return normalizeTeam(team, id);
      })
    : [];

  const seenMatches = new Set();
  tournament.matches = Array.isArray(input.matches)
    ? input.matches
        .map((match) => {
          let id = normalizeImportedId(match.id, "match");
          while (seenMatches.has(id)) {
            id = makeId("match");
          }
          seenMatches.add(id);
          try {
            return normalizeMatch(match, tournament, id);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];

  return tournament;
}

function normalizeData(input) {
  if (!input || typeof input !== "object") {
    return { data: defaultData(), changed: true };
  }

  if (Array.isArray(input.tournaments)) {
    const seen = new Set();
    const tournaments = input.tournaments.map((tournament) => {
      let id = normalizeImportedId(tournament.id, "season");
      while (seen.has(id)) {
        id = makeId("season");
      }
      seen.add(id);
      return normalizeTournament(tournament, id);
    });
    if (!tournaments.length) {
      tournaments.push(defaultTournament());
    }
    const activeTournamentId = tournaments.some((item) => item.id === input.activeTournamentId)
      ? input.activeTournamentId
      : tournaments[0].id;
    return {
      data: {
        schemaVersion: 2,
        activeTournamentId,
        tournaments,
        updatedAt: input.updatedAt || new Date().toISOString()
      },
      changed: input.schemaVersion !== 2
    };
  }

  const oldTournament = normalizeTournament({
    ...(input.tournament || {}),
    teams: input.teams || [],
    matches: input.matches || []
  });
  return {
    data: {
      schemaVersion: 2,
      activeTournamentId: oldTournament.id,
      tournaments: [oldTournament],
      updatedAt: input.updatedAt || new Date().toISOString()
    },
    changed: true
  };
}

function getTournament(data, tournamentId) {
  return (
    data.tournaments.find((tournament) => tournament.id === tournamentId) ||
    data.tournaments.find((tournament) => tournament.id === data.activeTournamentId) ||
    data.tournaments[0]
  );
}

function teamExists(tournament, id) {
  return tournament.teams.some((team) => team.id === id);
}

function teamName(tournament, id) {
  return tournament.teams.find((team) => team.id === id)?.name || "Equipo";
}

function publicPayload(data, selectedTournamentId) {
  const tournament = getTournament(data, selectedTournamentId);
  return {
    tournaments: data.tournaments.map((item) => ({
      id: item.id,
      name: item.name,
      season: item.season
    })),
    selectedTournamentId: tournament.id,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      subtitle: tournament.subtitle,
      season: tournament.season
    },
    teams: tournament.teams,
    matches: tournament.matches,
    standings: buildStandings(tournament),
    stats: buildStats(tournament),
    updatedAt: data.updatedAt
  };
}

function buildStandings(tournament) {
  const table = new Map(
    tournament.teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        teamName: team.name,
        shortName: team.shortName,
        logoDataUrl: team.logoDataUrl,
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

  for (const match of tournament.matches) {
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

function addPlayerStat(map, tournament, teamId, playerName, field) {
  const name = normalizeText(playerName, "", 80);
  if (!name) return;
  const key = `${teamId}:${name.toLocaleLowerCase("es")}`;
  const row = map.get(key) || {
    playerName: name,
    teamId,
    teamName: teamName(tournament, teamId),
    goals: 0,
    assists: 0,
    yellow: 0,
    red: 0,
    totalCards: 0,
    mvps: 0
  };
  row[field] += 1;
  if (field === "yellow" || field === "red") {
    row.totalCards += 1;
  }
  map.set(key, row);
}

function sortedStats(map, field) {
  return Array.from(map.values())
    .filter((row) => row[field] > 0)
    .sort((a, b) => {
      if (b[field] !== a[field]) return b[field] - a[field];
      return a.playerName.localeCompare(b.playerName, "es");
    });
}

function buildStats(tournament) {
  const goals = new Map();
  const assists = new Map();
  const cards = new Map();
  const mvps = new Map();

  for (const match of tournament.matches) {
    for (const goal of match.goals || []) {
      addPlayerStat(goals, tournament, goal.teamId, goal.playerName, "goals");
      addPlayerStat(assists, tournament, goal.teamId, goal.assistName, "assists");
    }
    for (const card of match.cards || []) {
      addPlayerStat(cards, tournament, card.teamId, card.playerName, normalizeCardType(card.type));
    }
    if (match.mvp) {
      addPlayerStat(mvps, tournament, match.mvp.teamId, match.mvp.playerName, "mvps");
    }
  }

  return {
    goals: sortedStats(goals, "goals"),
    assists: sortedStats(assists, "assists"),
    cards: Array.from(cards.values())
      .filter((row) => row.totalCards > 0)
      .sort((a, b) => {
        if (b.totalCards !== a.totalCards) return b.totalCards - a.totalCards;
        if (b.red !== a.red) return b.red - a.red;
        return a.playerName.localeCompare(b.playerName, "es");
      }),
    mvps: sortedStats(mvps, "mvps")
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/public") {
    sendJson(res, 200, publicPayload(await store.read(), url.searchParams.get("tournamentId")));
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

  const data = await store.read();
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readRequestJson(req) : {};

  if (req.method === "POST" && url.pathname === "/api/admin/tournaments") {
    const tournament = normalizeTournament({
      name: body.name,
      subtitle: body.subtitle,
      season: body.season,
      teams: [],
      matches: []
    });
    while (data.tournaments.some((item) => item.id === tournament.id)) {
      tournament.id = makeId("season");
    }
    data.tournaments.push(tournament);
    data.activeTournamentId = tournament.id;
    sendJson(res, 201, publicPayload(await store.write(data), tournament.id));
    return;
  }

  const tournamentMatch = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)(?:\/(.*))?$/);
  if (!tournamentMatch) {
    sendError(res, 404, "Ruta no encontrada.");
    return;
  }

  const tournamentId = decodeURIComponent(tournamentMatch[1]);
  const rest = tournamentMatch[2] || "";
  const tournamentIndex = data.tournaments.findIndex((item) => item.id === tournamentId);
  if (tournamentIndex === -1) {
    sendError(res, 404, "Temporada no encontrada.");
    return;
  }
  const tournament = data.tournaments[tournamentIndex];

  if (req.method === "DELETE" && rest === "") {
    if (data.tournaments.length <= 1) {
      sendError(res, 409, "No puedes borrar la unica temporada.");
      return;
    }
    data.tournaments.splice(tournamentIndex, 1);
    data.activeTournamentId = data.tournaments[0].id;
    sendJson(res, 200, publicPayload(await store.write(data), data.activeTournamentId));
    return;
  }

  if (req.method === "PUT" && rest === "settings") {
    data.tournaments[tournamentIndex] = {
      ...tournament,
      name: normalizeText(body.name, tournament.name, 80),
      subtitle: normalizeText(body.subtitle, tournament.subtitle, 120),
      season: normalizeText(body.season, tournament.season, 20)
    };
    data.activeTournamentId = tournament.id;
    sendJson(res, 200, publicPayload(await store.write(data), tournament.id));
    return;
  }

  if (req.method === "POST" && rest === "teams") {
    tournament.teams.push(normalizeTeam(body));
    sendJson(res, 201, publicPayload(await store.write(data), tournament.id));
    return;
  }

  const teamMatch = rest.match(/^teams\/([^/]+)$/);
  if (teamMatch) {
    const teamId = decodeURIComponent(teamMatch[1]);
    const index = tournament.teams.findIndex((team) => team.id === teamId);
    if (index === -1) {
      sendError(res, 404, "Equipo no encontrado.");
      return;
    }
    if (req.method === "PUT") {
      tournament.teams[index] = normalizeTeam(body, teamId);
      sendJson(res, 200, publicPayload(await store.write(data), tournament.id));
      return;
    }
    if (req.method === "DELETE") {
      const used = tournament.matches.some(
        (match) => match.homeTeamId === teamId || match.awayTeamId === teamId
      );
      if (used) {
        sendError(res, 409, "No puedes borrar un equipo con partidos asignados.");
        return;
      }
      tournament.teams.splice(index, 1);
      sendJson(res, 200, publicPayload(await store.write(data), tournament.id));
      return;
    }
  }

  if (req.method === "POST" && rest === "matches") {
    try {
      tournament.matches.push(normalizeMatch(body, tournament));
      sendJson(res, 201, publicPayload(await store.write(data), tournament.id));
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }

  const matchMatch = rest.match(/^matches\/([^/]+)$/);
  if (matchMatch) {
    const matchId = decodeURIComponent(matchMatch[1]);
    const index = tournament.matches.findIndex((match) => match.id === matchId);
    if (index === -1) {
      sendError(res, 404, "Partido no encontrado.");
      return;
    }
    if (req.method === "PUT") {
      try {
        tournament.matches[index] = normalizeMatch(body, tournament, matchId);
        sendJson(res, 200, publicPayload(await store.write(data), tournament.id));
      } catch (error) {
        sendError(res, 400, error.message);
      }
      return;
    }
    if (req.method === "DELETE") {
      tournament.matches.splice(index, 1);
      sendJson(res, 200, publicPayload(await store.write(data), tournament.id));
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
      "cache-control": extension === ".html" ? "no-store" : "no-cache"
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

async function main() {
  store = createStore({ defaultData, normalizeData });
  await store.init();

  server.listen(PORT, () => {
    if (!process.env.ADMIN_PASSWORD) {
      console.warn("ADMIN_PASSWORD no esta definido. Usando contrasena local: admin123");
    }
    console.log(`Almacenamiento: ${store.describe()}`);
    console.log(`Copa Facil disponible en http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
