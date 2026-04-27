const state = {
  data: null,
  authenticated: false,
  view: "public"
};

const els = {
  seasonLabel: document.querySelector("#seasonLabel"),
  tournamentName: document.querySelector("#tournamentName"),
  tournamentSubtitle: document.querySelector("#tournamentSubtitle"),
  metricTeams: document.querySelector("#metricTeams"),
  metricPlayed: document.querySelector("#metricPlayed"),
  metricPending: document.querySelector("#metricPending"),
  metricUpdated: document.querySelector("#metricUpdated"),
  standingsBody: document.querySelector("#standingsBody"),
  matchesList: document.querySelector("#matchesList"),
  matchFilter: document.querySelector("#matchFilter"),
  publicView: document.querySelector("#publicView"),
  adminView: document.querySelector("#adminView"),
  loginPanel: document.querySelector("#loginPanel"),
  adminPanel: document.querySelector("#adminPanel"),
  loginForm: document.querySelector("#loginForm"),
  logoutButton: document.querySelector("#logoutButton"),
  settingsForm: document.querySelector("#settingsForm"),
  teamForm: document.querySelector("#teamForm"),
  teamsAdminList: document.querySelector("#teamsAdminList"),
  matchForm: document.querySelector("#matchForm"),
  matchesAdminList: document.querySelector("#matchesAdminList"),
  toast: document.querySelector("#toast")
};

const statusLabels = {
  scheduled: "Pendiente",
  live: "En juego",
  finished: "Finalizado"
};

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

function findTeam(id) {
  return state.data.teams.find((team) => team.id === id) || {
    id,
    name: "Equipo eliminado",
    shortName: "---",
    color: "#64748b"
  };
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 2800);
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

async function loadData() {
  const [data, session] = await Promise.all([api("/api/public"), api("/api/admin/session")]);
  state.data = data;
  state.authenticated = Boolean(session.authenticated);
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

function render() {
  if (!state.data) return;
  const { tournament, teams, matches, standings, updatedAt } = state.data;
  els.seasonLabel.textContent = `Temporada ${tournament.season}`;
  els.tournamentName.textContent = tournament.name;
  els.tournamentSubtitle.textContent = tournament.subtitle;
  els.metricTeams.textContent = teams.length;
  els.metricPlayed.textContent = matches.filter((match) => match.status === "finished").length;
  els.metricPending.textContent = matches.filter((match) => match.status !== "finished").length;
  els.metricUpdated.textContent = formatShortDate(updatedAt);

  renderStandings(standings);
  renderMatches();
  renderAdmin();
  els.logoutButton.classList.toggle("hidden", !state.authenticated);
  els.loginPanel.classList.toggle("hidden", state.authenticated);
  els.adminPanel.classList.toggle("hidden", !state.authenticated);
  setView(state.view);
}

function renderStandings(standings) {
  els.standingsBody.innerHTML =
    standings
      .map(
        (row) => `
          <tr>
            <td>
              <span class="team-cell">
                <span class="team-dot" style="background:${escapeHtml(row.color)}"></span>
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

function renderMatches() {
  const filter = els.matchFilter.value;
  const matches = [...state.data.matches]
    .filter((match) => filter === "all" || match.status === filter)
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
              <span>${escapeHtml(match.round)} · ${formatDate(match.date)}</span>
              <span class="status ${escapeHtml(match.status)}">${statusLabels[match.status]}</span>
            </div>
            <div class="match-teams">
              <span class="team-cell">
                <span class="team-dot" style="background:${escapeHtml(home.color)}"></span>
                ${escapeHtml(home.name)}
              </span>
              <span class="score">${score}</span>
              <span class="team-cell">
                <span class="team-dot" style="background:${escapeHtml(away.color)}"></span>
                ${escapeHtml(away.name)}
              </span>
            </div>
          </article>
        `;
      })
      .join("") || `<div class="match-card">No hay partidos para este filtro.</div>`;
}

function renderAdmin() {
  if (!state.authenticated || !state.data) return;

  const { tournament } = state.data;
  els.settingsForm.name.value = tournament.name;
  els.settingsForm.subtitle.value = tournament.subtitle;
  els.settingsForm.season.value = tournament.season;

  const teamOptions = state.data.teams
    .map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`)
    .join("");
  els.matchForm.homeTeamId.innerHTML = teamOptions;
  els.matchForm.awayTeamId.innerHTML = teamOptions;
  if (state.data.teams[1]) {
    els.matchForm.awayTeamId.value = state.data.teams[1].id;
  }
  if (!els.matchForm.date.value) {
    els.matchForm.date.value = toDatetimeLocal(new Date().toISOString());
  }

  els.teamsAdminList.innerHTML =
    state.data.teams
      .map(
        (team) => `
          <form class="admin-row edit-grid" data-team-id="${escapeHtml(team.id)}">
            <input name="name" value="${escapeHtml(team.name)}" maxlength="60" required />
            <input name="shortName" value="${escapeHtml(team.shortName)}" maxlength="8" />
            <input name="color" type="color" value="${escapeHtml(team.color)}" aria-label="Color" />
            <button class="small-button" type="submit">Guardar</button>
            <button class="danger-button" type="button" data-delete-team="${escapeHtml(team.id)}">Borrar</button>
          </form>
        `
      )
      .join("") || `<div class="admin-row">No hay equipos.</div>`;

  els.matchesAdminList.innerHTML =
    [...state.data.matches]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(
        (match) => `
          <form class="admin-row edit-grid match-edit-grid" data-match-id="${escapeHtml(match.id)}">
            <input name="round" value="${escapeHtml(match.round)}" maxlength="40" required />
            <input name="date" type="datetime-local" value="${toDatetimeLocal(match.date)}" required />
            <select name="homeTeamId">${teamOptions}</select>
            <select name="awayTeamId">${teamOptions}</select>
            <input name="homeScore" type="number" min="0" max="99" value="${match.homeScore ?? ""}" placeholder="Local" />
            <input name="awayScore" type="number" min="0" max="99" value="${match.awayScore ?? ""}" placeholder="Visitante" />
            <select name="status">
              <option value="scheduled">Pendiente</option>
              <option value="live">En juego</option>
              <option value="finished">Finalizado</option>
            </select>
            <button class="small-button" type="submit">Guardar</button>
            <button class="danger-button" type="button" data-delete-match="${escapeHtml(match.id)}">Borrar</button>
          </form>
        `
      )
      .join("") || `<div class="admin-row">No hay partidos.</div>`;

  state.data.matches.forEach((match) => {
    const form = els.matchesAdminList.querySelector(`[data-match-id="${CSS.escape(match.id)}"]`);
    if (form) {
      form.homeTeamId.value = match.homeTeamId;
      form.awayTeamId.value = match.awayTeamId;
      form.status.value = match.status;
    }
  });
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function saveAndRefresh(path, options, successMessage) {
  state.data = await api(path, options);
  render();
  showToast(successMessage);
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.matchFilter.addEventListener("change", renderMatches);

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

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAndRefresh(
    "/api/admin/settings",
    { method: "PUT", body: JSON.stringify(formPayload(event.currentTarget)) },
    "Torneo actualizado."
  );
});

els.teamForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAndRefresh(
    "/api/admin/teams",
    { method: "POST", body: JSON.stringify(formPayload(event.currentTarget)) },
    "Equipo anadido."
  );
  event.currentTarget.reset();
  event.currentTarget.color.value = "#2563eb";
});

els.teamsAdminList.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-team-id]");
  if (!form) return;
  await saveAndRefresh(
    `/api/admin/teams/${encodeURIComponent(form.dataset.teamId)}`,
    { method: "PUT", body: JSON.stringify(formPayload(form)) },
    "Equipo guardado."
  );
});

els.teamsAdminList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-team]");
  if (!button) return;
  try {
    await saveAndRefresh(
      `/api/admin/teams/${encodeURIComponent(button.dataset.deleteTeam)}`,
      { method: "DELETE" },
      "Equipo borrado."
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.matchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveAndRefresh(
      "/api/admin/matches",
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
      `/api/admin/matches/${encodeURIComponent(form.dataset.matchId)}`,
      { method: "PUT", body: JSON.stringify(formPayload(form)) },
      "Partido guardado."
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.matchesAdminList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-match]");
  if (!button) return;
  await saveAndRefresh(
    `/api/admin/matches/${encodeURIComponent(button.dataset.deleteMatch)}`,
    { method: "DELETE" },
    "Partido borrado."
  );
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

loadData().catch((error) => showToast(error.message));
