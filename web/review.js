import {callApi} from './review/api.js';
import {el, isDisabled, setDisabled} from './review/dom.js';
import {createEpisodePanel} from './review/episodePanel.js';
import {findCurrentMonday, formatWeekLabel, readWeekFromQuery, addDays} from './review/weekDates.js';

const IMPORT_EXAMPLE =
  "curl -X POST http://127.0.0.1:8724/api/plans -H 'Content-Type: application/json' -d @week.json";

const page = {
  weekLabel: document.getElementById('week-label'),
  prevButton: document.getElementById('week-prev'),
  nextButton: document.getElementById('week-next'),
  approveButton: document.getElementById('week-approve'),
  note: document.getElementById('week-note'),
  error: document.getElementById('week-error'),
  state: document.getElementById('week-state'),
  panels: document.getElementById('panels'),
  publishLog: document.getElementById('publish-log'),
  publishList: document.getElementById('publish-list'),
  live: document.getElementById('live'),
};

const state = {weekStart: readWeekFromQuery(window.location.search) ?? findCurrentMonday(), plan: undefined};

if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';

function announce(message) {
  page.live.textContent = message;
}

function showWeekError(message) {
  page.error.hidden = message === undefined;
  page.error.textContent = message === undefined ? '' : `Error: ${message}`;
}

function showState(message, extraNodes = []) {
  page.state.replaceChildren(message, ...extraNodes);
  page.state.hidden = false;
}

function renderWeekControls() {
  page.weekLabel.textContent = formatWeekLabel(state.weekStart);
  const plan = state.plan;
  const activeEpisodes = plan ? plan.episodes.filter((episode) => episode.status !== 'skipped') : [];
  const isUnrendered = activeEpisodes.some((episode) => episode.renderPath === null);
  const isApproved = plan?.status === 'approved';
  page.approveButton.textContent = isApproved ? 'Approved' : 'Approve week';
  setDisabled(page.approveButton, !plan || isApproved || isUnrendered);
  if (!plan) page.note.textContent = '';
  else if (isUnrendered) page.note.textContent = 'Approve week unlocks when every night that is not skipped is rendered.';
  else page.note.textContent = isApproved ? 'This week is approved.' : 'Every night is rendered. You can approve the week.';
}

function buildPublishLine(publish, nightByEpisodeId) {
  const night = nightByEpisodeId.get(publish.episodeId);
  const checked = publish.lastCheckedAt ? `, last checked ${publish.lastCheckedAt}` : '';
  const text = `Night ${night ?? '?'}, ${publish.platform}: ${publish.status}, ${publish.attempts} attempt(s)${checked}`;
  return el('li', {text});
}

async function loadPublishes(plan) {
  const result = await callApi('GET', `/api/publishes?weekStart=${state.weekStart}`);
  const publishes = result.ok ? result.data : [];
  const nightByEpisodeId = new Map(plan.episodes.map((episode) => [episode.id, episode.night]));
  page.publishLog.hidden = false;
  if (!result.ok) {
    page.publishList.replaceChildren(el('li', {text: 'Could not read the publish log.'}));
    return new Set();
  }
  page.publishList.replaceChildren(
    ...(publishes.length === 0 ? [el('li', {text: 'Nothing sent yet.'})] : publishes.map((p) => buildPublishLine(p, nightByEpisodeId))),
  );
  return new Set(publishes.map((publish) => publish.episodeId));
}

function replaceEpisode(changedEpisode) {
  state.plan.episodes = state.plan.episodes.map((episode) => (episode.id === changedEpisode.id ? changedEpisode : episode));
  renderWeekControls();
}

function renderPlan(plan, sentEpisodeIds) {
  state.plan = plan;
  page.state.hidden = true;
  const panels = plan.episodes.map((episode) =>
    createEpisodePanel({
      episode,
      isSent: sentEpisodeIds.has(episode.id),
      callApi,
      announce,
      onEpisodeChange: replaceEpisode,
    }).element,
  );
  page.panels.replaceChildren(...panels);
  renderWeekControls();
}

function renderEmptyWeek() {
  state.plan = undefined;
  page.panels.replaceChildren();
  page.publishLog.hidden = true;
  showState('No plan for this week yet. Load a week file with plan.import:', [
    el('pre', {className: 'import-example', text: IMPORT_EXAMPLE}),
  ]);
  renderWeekControls();
}

function renderLoadError(message) {
  state.plan = undefined;
  page.panels.replaceChildren();
  page.publishLog.hidden = true;
  const retry = el('button', {className: 'n13-btn n13-btn--quiet', text: 'Retry', attrs: {type: 'button'}});
  retry.addEventListener('click', loadWeek);
  showState(el('p', {className: 'n13-balloon balloon--error', text: `Error: ${message}`, attrs: {role: 'alert'}}), [retry]);
  renderWeekControls();
}

async function loadWeek() {
  showWeekError(undefined);
  showState('Loading the week...');
  page.panels.replaceChildren();
  renderWeekControls();
  const result = await callApi('GET', `/api/plans/${state.weekStart}`);
  if (result.status === 404) return renderEmptyWeek();
  if (!result.ok) return renderLoadError(result.message);
  const sentEpisodeIds = await loadPublishes(result.data);
  renderPlan(result.data, sentEpisodeIds);
  announce(`${formatWeekLabel(state.weekStart)} loaded`);
}

function goToWeek(weekStart) {
  state.weekStart = weekStart;
  window.history.replaceState(null, '', `?week=${weekStart}`);
  loadWeek();
}

async function approveWeek() {
  if (!state.plan || isDisabled(page.approveButton)) return;
  showWeekError(undefined);
  page.note.textContent = 'Approving...';
  const result = await callApi('POST', `/api/plans/${state.weekStart}/approve`);
  if (!result.ok) {
    renderWeekControls();
    return showWeekError(result.message);
  }
  const sentEpisodeIds = await loadPublishes(result.data);
  renderPlan(result.data, sentEpisodeIds);
  announce('Week approved');
}

page.prevButton.addEventListener('click', () => goToWeek(addDays(state.weekStart, -7)));
page.nextButton.addEventListener('click', () => goToWeek(addDays(state.weekStart, 7)));
page.approveButton.addEventListener('click', approveWeek);

async function checkDaemon() {
  const result = await callApi('GET', '/api/health');
  if (!result.ok) showWeekError('The daemon is down.');
}

await checkDaemon();
await loadWeek();
