const state = {
  data: null,
  authenticated: false,
  view: "public",
  selectedTournamentId: null,
  selectedRound: "all",
  favoriteTeamIds: new Set(),
  pendingServiceWorker: null
};

const els = {
  seasonLabel: document.querySelector("#seasonLabel"),
  tournamentName: document.querySelector("#tournamentName"),
  tournamentSubtitle: document.querySelector("#tournamentSubtitle"),
  phaseLabel: document.querySelector("#phaseLabel"),
  tournamentSelect: document.querySelector("#tournamentSelect"),
  metricTeams: document.querySelector("#metricTeams"),
  metricPlayed: document.querySelector("#metricPlayed"),
  metricPending: document.querySelector("#metricPending"),
  metricUpdated: document.querySelector("#metricUpdated"),
  standingsBody: document.querySelector("#standingsBody"),
  matchesList: document.querySelector("#matchesList"),
  roundFilter: document.querySelector("#roundFilter"),
  matchFilter: document.querySelector("#matchFilter"),
  favoriteTeamsList: document.querySelector("#favoriteTeamsList"),
  notificationButton: document.querySelector("#notificationButton"),
  goalsStatsBody: document.querySelector("#goalsStatsBody"),
  assistsStatsBody: document.querySelector("#assistsStatsBody"),
  cardsStatsBody: document.querySelector("#cardsStatsBody"),
  mvpsStatsBody: document.querySelector("#mvpsStatsBody"),
  publicView: document.querySelector("#publicView"),
  adminView: document.querySelector("#adminView"),
  loginPanel: document.querySelector("#loginPanel"),
  adminPanel: document.querySelector("#adminPanel"),
  loginForm: document.querySelector("#loginForm"),
  adminPassword: document.querySelector("#adminPassword"),
  showPasswordCheckbox: document.querySelector("#showPasswordCheckbox"),
  logoutButton: document.querySelector("#logoutButton"),
  adminTournamentSelect: document.querySelector("#adminTournamentSelect"),
  tournamentForm: document.querySelector("#tournamentForm"),
  deleteTournamentButton: document.querySelector("#deleteTournamentButton"),
  settingsForm: document.querySelector("#settingsForm"),
  teamForm: document.querySelector("#teamForm"),
  teamsAdminList: document.querySelector("#teamsAdminList"),
  matchForm: document.querySelector("#matchForm"),
  matchesAdminList: document.querySelector("#matchesAdminList"),
  toast: document.querySelector("#toast"),
  updateBanner: document.querySelector("#updateBanner"),
  reloadUpdateButton: document.querySelector("#reloadUpdateButton")
};

const statusLabels = {
  scheduled: "Pendiente",
  live: "En juego",
  finished: "Finalizado"
};

const cardLabels = {
  yellow: "Amarilla",
  red: "Roja"
};

const MAX_LOGO_SOURCE_BYTES = 2_000_000;
const MAX_LOGO_DATA_URL_LENGTH = 70_000;
const LOGO_CANVAS_SIZE = 192;
const FAVORITES_KEY = "copa-facil-favorite-teams";
const SEEN_RESULTS_KEY = "copa-facil-seen-results";
const REFRESH_INTERVAL_MS = 60_000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function currentTournamentId() {
  return state.selectedTournamentId || state.data?.selectedTournamentId || "";
}

function adminBasePath() {
  return `/api/admin/tournaments/${encodeURIComponent(currentTournamentId())}`;
}

function findTeam(id) {
  return state.data.teams.find((team) => team.id === id) || {
    id,
    name: "Equipo eliminado",
    shortName: "---",
    logoDataUrl: ""
  };
}

function initials(value) {
  return String(value || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function teamLogoMarkup(team) {
  if (team.logoDataUrl) {
    return `<img class="team-logo" src="${escapeHtml(team.logoDataUrl)}" alt="" loading="lazy" />`;
  }
  return `<span class="team-logo team-logo-fallback">${escapeHtml(
    initials(team.shortName || team.teamName || team.name)
  )}</span>`;
}

function teamOptions(selectedId = "") {
  return state.data.teams
    .map(
      (team) =>
        `<option value="${escapeHtml(team.id)}" ${
          team.id === selectedId ? "selected" : ""
        }>${escapeHtml(team.name)}</option>`
    )
    .join("");
}

function roundOptions(selectedRound = "") {
  return (state.data.rounds || [])
    .map(
      (round) =>
        `<option value="${escapeHtml(round)}" ${round === selectedRound ? "selected" : ""}>${escapeHtml(
          round
        )}</option>`
    )
    .join("");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 2800);
}

function loadFavoriteTeamIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteTeamIds() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(state.favoriteTeamIds)));
}

function loadSeenResults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_RESULTS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeenResults(seenResults) {
  localStorage.setItem(SEEN_RESULTS_KEY, JSON.stringify(seenResults));
}

function finishedResultSignature(match) {
  if (
    match.status !== "finished" ||
    !Number.isInteger(match.homeScore) ||
    !Number.isInteger(match.awayScore)
  ) {
    return "";
  }
  return `${match.status}:${match.homeScore}-${match.awayScore}`;
}

function resultTitle(match) {
  const home = findTeam(match.homeTeamId);
  const away = findTeam(match.awayTeamId);
  return `${home.name} ${match.homeScore} - ${match.awayScore} ${away.name}`;
}

function resultBody(match) {
  return `${match.round} - ${statusLabels[match.status]}`;
}

async function showResultNotification(match) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const options = {
    body: resultBody(match),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `copa-facil-result-${match.id}`,
    data: { url: "/" }
  };
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification(resultTitle(match), options);
      return;
    }
  } catch {
    // Fall back to the page notification below.
  }
  new Notification(resultTitle(match), options);
}

function syncSeenResults(data, notify = true) {
  if (!data?.matches) return;
  const tournamentId = data.selectedTournamentId;
  const seenResults = loadSeenResults();
  const seenTournament = seenResults[tournamentId] || {};
  const firstSync = !seenResults[tournamentId];
  const nextSeenTournament = { ...seenTournament };

  data.matches.forEach((match) => {
    const signature = finishedResultSignature(match);
    if (!signature) return;

    const favoriteMatch =
      state.favoriteTeamIds.has(match.homeTeamId) || state.favoriteTeamIds.has(match.awayTeamId);
    const changed = seenTournament[match.id] && seenTournament[match.id] !== signature;

    if (notify && !firstSync && favoriteMatch && changed) {
      showResultNotification(match);
    }
    nextSeenTournament[match.id] = signature;
  });

  seenResults[tournamentId] = nextSeenTournament;
  saveSeenResults(seenResults);
}

function notificationButtonText() {
  if (!("Notification" in window)) return "No compatible";
  if (Notification.permission === "granted") return "Notificaciones activas";
  if (Notification.permission === "denied") return "Notificaciones bloqueadas";
  return "Activar notificaciones";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "No se pudo completar la accion.");
  }
  return payload;
}

async function loadData(tournamentId = state.selectedTournamentId) {
  const query = tournamentId ? `?tournamentId=${encodeURIComponent(tournamentId)}` : "";
  const [data, session] = await Promise.all([api(`/api/public${query}`), api("/api/admin/session")]);
  state.data = data;
  state.selectedTournamentId = data.selectedTournamentId;
  state.authenticated = Boolean(session.authenticated);
  syncSeenResults(data);
  render();
}

function setView(view) {
  state.view = view;
  els.publicView.classList.toggle("hidden", view !== "public");
  els.adminView.classList.toggle("hidden", view !== "admin");
  document
    .querySelectorAll("[data-view]")
    .forEach((button) => button.classList.toggle("primary-button", button.dataset.view === view));
}

function renderTournamentSelectors() {
  const options = state.data.tournaments
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${
          item.id === state.selectedTournamentId ? "selected" : ""
        }>${escapeHtml(item.season)} - ${escapeHtml(item.name)}</option>`
    )
    .join("");
  els.tournamentSelect.innerHTML = options;
  els.adminTournamentSelect.innerHTML = options;
}

function render() {
  if (!state.data) return;
  const { tournament, teams, matches, standings, updatedAt } = state.data;
  els.seasonLabel.textContent = `Temporada ${tournament.season}`;
  els.tournamentName.textContent = tournament.name;
  els.tournamentSubtitle.textContent = tournament.subtitle;
  els.phaseLabel.textContent = tournament.name;
  els.metricTeams.textContent = teams.length;
  els.metricPlayed.textContent = matches.filter((match) => match.status === "finished").length;
  els.metricPending.textContent = matches.filter((match) => match.status !== "finished").length;
  els.metricUpdated.textContent = formatShortDate(updatedAt);

  renderTournamentSelectors();
  renderRoundSelector();
  renderStandings(standings);
  renderMatches();
  renderStats();
  renderFavorites();
  renderAdmin();
  els.logoutButton.classList.toggle("hidden", !state.authenticated);
  els.loginPanel.classList.toggle("hidden", state.authenticated);
  els.adminPanel.classList.toggle("hidden", !state.authenticated);
  setView(state.view);
}

function renderRoundSelector() {
  const rounds = state.data.rounds || [];
  if (state.selectedRound !== "all" && !rounds.includes(state.selectedRound)) {
    state.selectedRound = "all";
  }
  els.roundFilter.innerHTML = [
    `<option value="all">Todas las jornadas</option>`,
    ...rounds.map(
      (round) =>
        `<option value="${escapeHtml(round)}" ${round === state.selectedRound ? "selected" : ""}>${escapeHtml(
          round
        )}</option>`
    )
  ].join("");
}

function renderStandings(standings) {
  els.standingsBody.innerHTML =
    standings
      .map(
        (row) => `
          <tr>
            <td>
              <span class="team-cell">
                ${teamLogoMarkup(row)}
                ${escapeHtml(row.teamName)}
              </span>
            </td>
            <td>${row.played}</td>
            <td>${row.won}</td>
            <td>${row.drawn}</td>
            <td>${row.lost}</td>
            <td>${row.goalDifference}</td>
            <td><strong>${row.points}</strong></td>
          </tr>
        `
      )
      .join("") || `<tr><td colspan="7">Todavia no hay equipos.</td></tr>`;
}

function renderMatchDetails(match) {
  const goals = (match.goals || [])
    .map((goal) => {
      const assist = goal.assistName ? `, asistencia: ${escapeHtml(goal.assistName)}` : "";
      return `<li>${escapeHtml(goal.playerName)} (${escapeHtml(findTeam(goal.teamId).shortName)}${assist})</li>`;
    })
    .join("");
  const cards = (match.cards || [])
    .map(
      (card) =>
        `<li>${escapeHtml(card.playerName)} (${escapeHtml(findTeam(card.teamId).shortName)}) - ${
          cardLabels[card.type]
        }</li>`
    )
    .join("");
  const mvp = match.mvp
    ? `<li>${escapeHtml(match.mvp.playerName)} (${escapeHtml(findTeam(match.mvp.teamId).shortName)})</li>`
    : "";

  if (!goals && !cards && !mvp) return "";
  return `
    <div class="match-detail-grid">
      <div><strong>Goles</strong><ul>${goals || "<li>Sin registro</li>"}</ul></div>
      <div><strong>Tarjetas</strong><ul>${cards || "<li>Sin registro</li>"}</ul></div>
      <div><strong>MVP</strong><ul>${mvp || "<li>Sin registro</li>"}</ul></div>
    </div>
  `;
}

function renderMatches() {
  const filter = els.matchFilter.value;
  const round = state.selectedRound;
  const matches = [...state.data.matches]
    .filter((match) => filter === "all" || match.status === filter)
    .filter((match) => round === "all" || match.round === round)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  els.matchesList.innerHTML =
    matches
      .map((match) => {
        const home = findTeam(match.homeTeamId);
        const away = findTeam(match.awayTeamId);
        const score =
          Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore)
            ? `${match.homeScore} - ${match.awayScore}`
            : "vs";
        return `
          <article class="match-card">
            <div class="match-meta">
              <span>${escapeHtml(match.round)} - ${formatDate(match.date)}</span>
              <span class="status ${escapeHtml(match.status)}">${statusLabels[match.status]}</span>
            </div>
            <div class="match-teams">
              <span class="team-cell">
                ${teamLogoMarkup(home)}
                ${escapeHtml(home.name)}
              </span>
              <span class="score">${score}</span>
              <span class="team-cell">
                ${teamLogoMarkup(away)}
                ${escapeHtml(away.name)}
              </span>
            </div>
            ${renderMatchDetails(match)}
          </article>
        `;
      })
      .join("") || `<div class="match-card">No hay partidos para este filtro.</div>`;
}

function renderStatRows(rows, valueField, emptyMessage, extra = "") {
  return (
    rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.playerName)}</td>
            <td>${escapeHtml(row.teamName)}</td>
            ${extra ? extra(row) : `<td><strong>${row[valueField]}</strong></td>`}
          </tr>
        `
      )
      .join("") || `<tr><td colspan="4">${emptyMessage}</td></tr>`
  );
}

function renderStats() {
  const stats = state.data.stats || { goals: [], assists: [], cards: [], mvps: [] };
  els.goalsStatsBody.innerHTML = renderStatRows(stats.goals, "goals", "Sin goles registrados.");
  els.assistsStatsBody.innerHTML = renderStatRows(stats.assists, "assists", "Sin asistencias registradas.");
  els.cardsStatsBody.innerHTML = renderStatRows(
    stats.cards,
    "totalCards",
    "Sin tarjetas registradas.",
    (row) => `<td><strong>${row.yellow}</strong></td><td><strong>${row.red}</strong></td>`
  );
  els.mvpsStatsBody.innerHTML = renderStatRows(stats.mvps, "mvps", "Sin MVPs registrados.");
}

function renderFavorites() {
  els.notificationButton.textContent = notificationButtonText();
  els.notificationButton.disabled = !("Notification" in window) || Notification.permission === "denied";
  els.favoriteTeamsList.innerHTML =
    state.data.teams
      .map(
        (team) => `
          <label class="favorite-chip">
            <input type="checkbox" value="${escapeHtml(team.id)}" ${
              state.favoriteTeamIds.has(team.id) ? "checked" : ""
            } />
            ${teamLogoMarkup(team)}
            <span>${escapeHtml(team.name)}</span>
          </label>
        `
      )
      .join("") || `<span class="muted">Anade equipos para elegir favoritos.</span>`;
}

function renderAdmin() {
  if (!state.authenticated || !state.data) return;

  const { tournament } = state.data;
  els.settingsForm.name.value = tournament.name;
  els.settingsForm.subtitle.value = tournament.subtitle;
  els.settingsForm.season.value = tournament.season;
  els.settingsForm.roundCount.value = tournament.roundCount || state.data.rounds?.length || 1;
  els.deleteTournamentButton.disabled = state.data.tournaments.length <= 1;

  els.matchForm.round.innerHTML = roundOptions(state.data.rounds?.[0] || "");
  els.matchForm.homeTeamId.innerHTML = teamOptions();
  els.matchForm.awayTeamId.innerHTML = teamOptions(state.data.teams[1]?.id || "");
  if (!els.matchForm.date.value) {
    els.matchForm.date.value = toDatetimeLocal(new Date().toISOString());
  }

  els.teamsAdminList.innerHTML =
    state.data.teams
      .map(
        (team) => `
          <form class="admin-row edit-grid team-edit-grid" data-team-id="${escapeHtml(team.id)}">
            <span class="team-logo-preview">${teamLogoMarkup(team)}</span>
            <input name="name" value="${escapeHtml(team.name)}" maxlength="60" required />
            <input name="shortName" value="${escapeHtml(team.shortName)}" maxlength="8" />
            <input name="logoDataUrl" type="hidden" value="${escapeHtml(team.logoDataUrl || "")}" />
            <label class="small-button file-picker" for="logo-${escapeHtml(team.id)}">Logo</label>
            <input
              class="visually-hidden"
              id="logo-${escapeHtml(team.id)}"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              data-team-logo-input
            />
            <button class="small-button" type="button" data-clear-logo>Sin logo</button>
            <button class="small-button" type="submit">Guardar</button>
            <button class="danger-button" type="button" data-delete-team="${escapeHtml(team.id)}">Borrar</button>
          </form>
        `
      )
      .join("") || `<div class="admin-row">No hay equipos.</div>`;

  els.matchesAdminList.innerHTML =
    [...state.data.matches]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(renderAdminMatch)
      .join("") || `<div class="admin-row">No hay partidos.</div>`;
}

function renderAdminMatch(match) {
  return `
    <form class="admin-row match-admin-card" data-match-id="${escapeHtml(match.id)}">
      <div class="match-edit-grid">
        <select name="round">${roundOptions(match.round)}</select>
        <input name="date" type="datetime-local" value="${toDatetimeLocal(match.date)}" required />
        <select name="homeTeamId">${teamOptions(match.homeTeamId)}</select>
        <select name="awayTeamId">${teamOptions(match.awayTeamId)}</select>
        <input name="homeScore" type="number" min="0" max="99" value="${match.homeScore ?? ""}" placeholder="Local" />
        <input name="awayScore" type="number" min="0" max="99" value="${match.awayScore ?? ""}" placeholder="Visitante" />
        <select name="status">
          <option value="scheduled" ${match.status === "scheduled" ? "selected" : ""}>Pendiente</option>
          <option value="live" ${match.status === "live" ? "selected" : ""}>En juego</option>
          <option value="finished" ${match.status === "finished" ? "selected" : ""}>Finalizado</option>
        </select>
      </div>
      <div class="event-editor">
        <div class="event-block">
          <div class="event-head">
            <strong>Goles y asistencias</strong>
            <button class="small-button" type="button" data-add-goal>+ Gol</button>
          </div>
          <div class="event-rows goals-editor">
            ${(match.goals || []).map(renderGoalRow).join("")}
          </div>
        </div>
        <div class="event-block">
          <div class="event-head">
            <strong>Tarjetas</strong>
            <button class="small-button" type="button" data-add-card>+ Tarjeta</button>
          </div>
          <div class="event-rows cards-editor">
            ${(match.cards || []).map(renderCardRow).join("")}
          </div>
        </div>
        <div class="event-block">
          <strong>MVP</strong>
          <div class="mvp-row">
            <select name="mvpTeamId">${teamOptions(match.mvp?.teamId || match.homeTeamId)}</select>
            <input name="mvpPlayerName" value="${escapeHtml(match.mvp?.playerName || "")}" maxlength="80" placeholder="Jugador MVP" />
          </div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="small-button" type="submit">Guardar partido</button>
        <button class="danger-button" type="button" data-delete-match="${escapeHtml(match.id)}">Borrar partido</button>
      </div>
    </form>
  `;
}

function renderGoalRow(goal = {}) {
  return `
    <div class="event-row goal-row">
      <select data-field="teamId">${teamOptions(goal.teamId || state.data.teams[0]?.id || "")}</select>
      <input data-field="playerName" value="${escapeHtml(goal.playerName || "")}" maxlength="80" placeholder="Goleador" />
      <input data-field="assistName" value="${escapeHtml(goal.assistName || "")}" maxlength="80" placeholder="Asistencia" />
      <button class="danger-button" type="button" data-remove-event>Borrar</button>
    </div>
  `;
}

function renderCardRow(card = {}) {
  return `
    <div class="event-row card-row">
      <select data-field="teamId">${teamOptions(card.teamId || state.data.teams[0]?.id || "")}</select>
      <input data-field="playerName" value="${escapeHtml(card.playerName || "")}" maxlength="80" placeholder="Jugador" />
      <select data-field="type">
        <option value="yellow" ${card.type !== "red" ? "selected" : ""}>Amarilla</option>
        <option value="red" ${card.type === "red" ? "selected" : ""}>Roja</option>
      </select>
      <button class="danger-button" type="button" data-remove-event>Borrar</button>
    </div>
  `;
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      reject(new Error("El logo debe ser PNG, JPG o WEBP."));
      return;
    }
    if (file.size > MAX_LOGO_SOURCE_BYTES) {
      reject(new Error("El logo no puede superar 2 MB."));
      return;
    }

    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error("No se pudo procesar el logo."));
    };
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = LOGO_CANVAS_SIZE;
      canvas.height = LOGO_CANVAS_SIZE;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, LOGO_CANVAS_SIZE, LOGO_CANVAS_SIZE);

      const scale = Math.min(LOGO_CANVAS_SIZE / image.width, LOGO_CANVAS_SIZE / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const x = (LOGO_CANVAS_SIZE - width) / 2;
      const y = (LOGO_CANVAS_SIZE - height) / 2;
      context.drawImage(image, x, y, width, height);
      URL.revokeObjectURL(image.src);

      const qualities = [0.82, 0.72, 0.62, 0.52, 0.42];
      const dataUrl = qualities.map((quality) => canvas.toDataURL("image/webp", quality)).find((item) => {
        return item.length <= MAX_LOGO_DATA_URL_LENGTH;
      });
      if (!dataUrl) {
        reject(new Error("El logo es demasiado pesado. Usa una imagen mas simple o con menos detalle."));
        return;
      }
      resolve(dataUrl);
    };
    image.src = URL.createObjectURL(file);
  });
}

async function teamPayload(form) {
  const payload = formPayload(form);
  delete payload.logoFile;

  const hiddenLogo = form.querySelector('input[name="logoDataUrl"]');
  const fileInput = form.querySelector('input[type="file"]');
  payload.logoDataUrl = hiddenLogo ? hiddenLogo.value : "";
  if (fileInput?.files?.[0]) {
    payload.logoDataUrl = await imageFileToDataUrl(fileInput.files[0]);
  }
  return payload;
}

function matchPayload(form) {
  const payload = formPayload(form);
  payload.goals = Array.from(form.querySelectorAll(".goal-row"))
    .map((row) => ({
      teamId: row.querySelector('[data-field="teamId"]').value,
      playerName: row.querySelector('[data-field="playerName"]').value,
      assistName: row.querySelector('[data-field="assistName"]').value
    }))
    .filter((goal) => goal.playerName.trim());
  payload.cards = Array.from(form.querySelectorAll(".card-row"))
    .map((row) => ({
      teamId: row.querySelector('[data-field="teamId"]').value,
      playerName: row.querySelector('[data-field="playerName"]').value,
      type: row.querySelector('[data-field="type"]').value
    }))
    .filter((card) => card.playerName.trim());
  payload.mvp = payload.mvpPlayerName?.trim()
    ? { teamId: payload.mvpTeamId, playerName: payload.mvpPlayerName }
    : null;
  delete payload.mvpTeamId;
  delete payload.mvpPlayerName;
  return payload;
}

async function saveAndRefresh(path, options, successMessage) {
  state.data = await api(path, options);
  state.selectedTournamentId = state.data.selectedTournamentId;
  render();
  showToast(successMessage);
}

state.favoriteTeamIds = loadFavoriteTeamIds();

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.tournamentSelect.addEventListener("change", () => {
  state.selectedRound = "all";
  loadData(els.tournamentSelect.value);
});
els.adminTournamentSelect.addEventListener("change", () => {
  state.selectedRound = "all";
  loadData(els.adminTournamentSelect.value);
});
els.roundFilter.addEventListener("change", () => {
  state.selectedRound = els.roundFilter.value;
  renderMatches();
});
els.matchFilter.addEventListener("change", renderMatches);

els.favoriteTeamsList.addEventListener("change", (event) => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  if (input.checked) {
    state.favoriteTeamIds.add(input.value);
  } else {
    state.favoriteTeamIds.delete(input.value);
  }
  saveFavoriteTeamIds();
  syncSeenResults(state.data, false);
});

els.notificationButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Este navegador no soporta notificaciones.");
    return;
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  renderFavorites();
  showToast(Notification.permission === "granted" ? "Notificaciones activadas." : "Notificaciones bloqueadas.");
});

els.showPasswordCheckbox.addEventListener("change", () => {
  els.adminPassword.type = els.showPasswordCheckbox.checked ? "text" : "password";
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    state.authenticated = true;
    state.view = "admin";
    await loadData();
    showToast("Sesion iniciada.");
  } catch (error) {
    showToast(error.message);
  }
});

els.logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  state.authenticated = false;
  state.view = "public";
  render();
  showToast("Sesion cerrada.");
});

els.tournamentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAndRefresh(
    "/api/admin/tournaments",
    { method: "POST", body: JSON.stringify(formPayload(event.currentTarget)) },
    "Temporada creada."
  );
  event.currentTarget.reset();
});

els.deleteTournamentButton.addEventListener("click", async () => {
  if (!window.confirm("Borrar esta temporada eliminara sus equipos, partidos y estadisticas.")) {
    return;
  }
  await saveAndRefresh(adminBasePath(), { method: "DELETE" }, "Temporada borrada.");
});

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAndRefresh(
    `${adminBasePath()}/settings`,
    { method: "PUT", body: JSON.stringify(formPayload(event.currentTarget)) },
    "Torneo actualizado."
  );
});

els.teamForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveAndRefresh(
      `${adminBasePath()}/teams`,
      { method: "POST", body: JSON.stringify(await teamPayload(event.currentTarget)) },
      "Equipo anadido."
    );
    event.currentTarget.reset();
  } catch (error) {
    showToast(error.message);
  }
});

els.teamsAdminList.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-team-id]");
  if (!form) return;
  try {
    await saveAndRefresh(
      `${adminBasePath()}/teams/${encodeURIComponent(form.dataset.teamId)}`,
      { method: "PUT", body: JSON.stringify(await teamPayload(form)) },
      "Equipo guardado."
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.teamsAdminList.addEventListener("click", async (event) => {
  const clearLogoButton = event.target.closest("[data-clear-logo]");
  if (clearLogoButton) {
    const form = clearLogoButton.closest("[data-team-id]");
    form.querySelector('input[name="logoDataUrl"]').value = "";
    form.querySelector('input[type="file"]').value = "";
    const preview = form.querySelector(".team-logo-preview");
    preview.innerHTML = teamLogoMarkup({
      name: form.name.value,
      shortName: form.shortName.value,
      logoDataUrl: ""
    });
    return;
  }

  const button = event.target.closest("[data-delete-team]");
  if (!button) return;
  try {
    await saveAndRefresh(
      `${adminBasePath()}/teams/${encodeURIComponent(button.dataset.deleteTeam)}`,
      { method: "DELETE" },
      "Equipo borrado."
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.teamsAdminList.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-team-logo-input]");
  if (!input?.files?.[0]) return;
  const form = input.closest("[data-team-id]");
  try {
    const logoDataUrl = await imageFileToDataUrl(input.files[0]);
    form.querySelector('input[name="logoDataUrl"]').value = logoDataUrl;
    form.querySelector(".team-logo-preview").innerHTML = teamLogoMarkup({
      shortName: form.shortName.value,
      logoDataUrl
    });
  } catch (error) {
    input.value = "";
    showToast(error.message);
  }
});

els.matchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveAndRefresh(
      `${adminBasePath()}/matches`,
      { method: "POST", body: JSON.stringify(formPayload(event.currentTarget)) },
      "Partido creado."
    );
    event.currentTarget.reset();
    els.matchForm.date.value = toDatetimeLocal(new Date().toISOString());
  } catch (error) {
    showToast(error.message);
  }
});

els.matchesAdminList.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-match-id]");
  if (!form) return;
  try {
    await saveAndRefresh(
      `${adminBasePath()}/matches/${encodeURIComponent(form.dataset.matchId)}`,
      { method: "PUT", body: JSON.stringify(matchPayload(form)) },
      "Partido guardado."
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.matchesAdminList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-match]");
  if (deleteButton) {
    await saveAndRefresh(
      `${adminBasePath()}/matches/${encodeURIComponent(deleteButton.dataset.deleteMatch)}`,
      { method: "DELETE" },
      "Partido borrado."
    );
    return;
  }

  const removeEventButton = event.target.closest("[data-remove-event]");
  if (removeEventButton) {
    removeEventButton.closest(".event-row").remove();
    return;
  }

  const matchForm = event.target.closest("[data-match-id]");
  if (!matchForm) return;
  if (event.target.closest("[data-add-goal]")) {
    matchForm.querySelector(".goals-editor").insertAdjacentHTML("beforeend", renderGoalRow());
  }
  if (event.target.closest("[data-add-card]")) {
    matchForm.querySelector(".cards-editor").insertAdjacentHTML("beforeend", renderCardRow());
  }
});

function showUpdateBanner(worker) {
  state.pendingServiceWorker = worker;
  els.updateBanner.classList.remove("hidden");
}

els.reloadUpdateButton.addEventListener("click", () => {
  if (!state.pendingServiceWorker) {
    window.location.reload();
    return;
  }
  state.pendingServiceWorker.postMessage({ type: "SKIP_WAITING" });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting) {
        showUpdateBanner(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(worker);
          }
        });
      });
    }).catch(() => {});
  });
}

loadData().catch((error) => showToast(error.message));
window.setInterval(() => {
  loadData(currentTournamentId()).catch(() => {});
}, REFRESH_INTERVAL_MS);
