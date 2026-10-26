import {el, isDisabled, setDisabled} from './dom.js';
import {toInputValue, toIsoWithOffset} from './weekDates.js';

const STATUS_WORDS = {
  planned: {word: 'Planned', className: 'n13-tag'},
  rendering: {word: 'Rendering', className: 'n13-tag n13-tag--caption'},
  ready: {word: 'Ready', className: 'n13-tag n13-tag--caption'},
  approved: {word: 'Approved', className: 'n13-tag n13-tag--accent'},
  skipped: {word: 'Skipped', className: 'n13-tag tag--skipped'},
  not_new: {word: 'Not new', className: 'n13-tag n13-tag--danger'},
};

const LABEL_CHOICES = [
  {value: 'label_on', text: 'AI label on'},
  {value: 'label_off', text: 'AI label off'},
];

function buildLabelChoices(episode) {
  const name = `label-${episode.id}`;
  const hintId = `label-hint-${episode.id}`;
  const radios = LABEL_CHOICES.map((choice) => {
    const input = el('input', {attrs: {type: 'radio', name, value: choice.value, 'aria-describedby': hintId}});
    return {input, label: el('label', {className: 'choice'}, [input, el('span', {text: choice.text})])};
  });
  const hint = el('p', {className: 'hint', text: 'On only if a frame is photoreal.', attrs: {id: hintId}});
  const fieldset = el('fieldset', {className: 'field'}, [
    el('legend', {text: `AI label, night ${episode.night}`}),
    ...radios.map((radio) => radio.label),
    hint,
  ]);
  return {fieldset, radios: radios.map((radio) => radio.input)};
}

/**
 * One panel per night. It owns its DOM and updates it in place, so typed values and focus survive a
 * save. The page hands in callApi, an announce function for the live region, and an onEpisodeChange hook.
 */
export function createEpisodePanel({episode, isSent, callApi, announce, onEpisodeChange}) {
  let current = episode;
  let isSentNight = isSent;
  let isBusy = false;
  const night = episode.night;

  const title = el('h2', {className: 'panel-title', text: `Night ${night}`, attrs: {id: `night-${episode.id}`}});
  const statusTag = el('span');
  const previewSlot = el('div', {className: 'preview'});
  const onScreenText = el('p', {className: 'on-screen-text'});
  const claimText = el('p', {className: 'claim'});
  const trackText = el('p', {className: 'meta'});

  const timeId = `time-${episode.id}`;
  const errorId = `error-${episode.id}`;
  const timeInput = el('input', {className: 'control', attrs: {type: 'datetime-local', id: timeId, required: ''}});
  const timeField = el('div', {className: 'field'}, [
    el('label', {text: `Publish time, night ${night} (Europe/Ljubljana)`, attrs: {for: timeId}}),
    timeInput,
  ]);
  const labelChoices = buildLabelChoices(episode);

  const saveButton = el('button', {className: 'n13-btn n13-btn--quiet', text: `Save night ${night}`, attrs: {type: 'button'}});
  const approveButton = el('button', {className: 'n13-btn', text: `Approve night ${night}`, attrs: {type: 'button'}});
  const skipButton = el('button', {className: 'n13-btn n13-btn--quiet', text: `Skip night ${night}`, attrs: {type: 'button'}});
  const statusBalloon = el('p', {className: 'n13-balloon', attrs: {role: 'status'}});
  const errorBalloon = el('p', {className: 'n13-balloon balloon--error', attrs: {role: 'alert', id: errorId}});
  statusBalloon.hidden = true;
  errorBalloon.hidden = true;

  const element = el('article', {className: 'n13-panel episode-panel', attrs: {'aria-labelledby': title.id}}, [
    el('div', {className: 'panel-head'}, [title, statusTag]),
    previewSlot,
    onScreenText,
    claimText,
    trackText,
    el('div', {className: 'panel-form'}, [timeField, labelChoices.fieldset]),
    el('div', {className: 'actions'}, [saveButton, approveButton, skipButton]),
    el('div', {className: 'balloons'}, [statusBalloon, errorBalloon]),
  ]);

  function showBalloon(kind, text) {
    statusBalloon.hidden = kind === 'error' || kind === 'none';
    errorBalloon.hidden = kind !== 'error';
    if (kind === 'error') errorBalloon.textContent = `Error: ${text}`;
    else statusBalloon.textContent = text;
    timeInput.removeAttribute('aria-invalid');
    timeInput.removeAttribute('aria-describedby');
    if (kind === 'error') {
      timeInput.setAttribute('aria-invalid', 'true');
      timeInput.setAttribute('aria-describedby', errorId);
    }
  }

  function renderPreview() {
    const hasVideo = previewSlot.firstElementChild?.tagName === 'VIDEO';
    if (current.renderPath === null) {
      previewSlot.replaceChildren(el('p', {className: 'no-render', text: 'Not rendered yet. Render this night, then approve it.'}));
      return;
    }
    if (hasVideo) return;
    const video = el('video', {
      attrs: {controls: '', preload: 'metadata', src: `/media/${current.id}.mp4`, 'aria-label': `Preview of night ${night}`},
    });
    previewSlot.replaceChildren(video);
  }

  function renderButtons() {
    const isApproved = current.status === 'approved';
    const isSkipped = current.status === 'skipped';
    approveButton.textContent = isApproved ? 'Approved' : `Approve night ${night}`;
    skipButton.textContent = isSkipped ? 'Skipped' : `Skip night ${night}`;
    setDisabled(approveButton, current.renderPath === null || isApproved || isSkipped);
    setDisabled(skipButton, isSentNight || isSkipped);
    setDisabled(saveButton, isSentNight);
    timeInput.disabled = isSentNight;
    for (const radio of labelChoices.radios) radio.disabled = isSentNight;
  }

  function renderEpisode() {
    const status = STATUS_WORDS[current.status];
    statusTag.className = status.className;
    statusTag.textContent = isSentNight ? `${status.word}, sent` : status.word;
    title.textContent = `Night ${night}: ${current.trackSlug}`;
    onScreenText.textContent = current.caption;
    onScreenText.setAttribute('aria-label', 'On-screen text');
    claimText.textContent = `Claim: ${current.claim}`;
    trackText.textContent = `${current.format.replace('_', ' ')}, from ${current.startSecond}s for ${current.durationSeconds}s`;
    timeInput.value = toInputValue(current.publishAt);
    for (const radio of labelChoices.radios) radio.checked = radio.value === current.labelDecision;
    renderPreview();
    renderButtons();
  }

  function takeEpisode(next) {
    current = next;
    renderEpisode();
    onEpisodeChange(next);
  }

  function collectChanges() {
    const changes = {};
    if (timeInput.value !== toInputValue(current.publishAt)) {
      const publishAt = toIsoWithOffset(timeInput.value);
      if (publishAt === null) return {error: 'That time does not exist on that day.'};
      changes.publishAt = publishAt;
    }
    const checked = labelChoices.radios.find((radio) => radio.checked);
    if (checked && checked.value !== current.labelDecision) changes.labelDecision = checked.value;
    return {changes};
  }

  async function runAction(options) {
    if (isBusy || isDisabled(options.button)) return;
    isBusy = true;
    element.setAttribute('aria-busy', 'true');
    showBalloon('busy', options.busyText);
    announce(`${options.busyText} night ${night}`);
    const result = await options.call();
    isBusy = false;
    element.removeAttribute('aria-busy');
    if (result.ok) {
      takeEpisode(result.data);
      showBalloon('saved', options.doneText);
      announce(`Night ${night}: ${options.doneText}`);
      return;
    }
    if (result.code === 'already_sent') {
      isSentNight = true;
      renderEpisode();
    }
    showBalloon('error', result.message);
  }

  saveButton.addEventListener('click', () => {
    const {changes, error} = collectChanges();
    if (error) return showBalloon('error', error);
    if (Object.keys(changes).length === 0) return showBalloon('saved', 'Nothing to save');
    return runAction({
      button: saveButton,
      busyText: 'Saving...',
      doneText: 'Saved',
      call: () => callApi('PATCH', `/api/episodes/${current.id}`, changes),
    });
  });
  approveButton.addEventListener('click', () =>
    runAction({
      button: approveButton,
      busyText: 'Approving...',
      doneText: 'Approved',
      call: () => callApi('POST', `/api/episodes/${current.id}/approve`),
    }),
  );
  skipButton.addEventListener('click', () =>
    runAction({
      button: skipButton,
      busyText: 'Skipping...',
      doneText: 'Skipped',
      call: () => callApi('POST', `/api/episodes/${current.id}/skip`),
    }),
  );

  renderEpisode();
  return {element};
}
