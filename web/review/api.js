const DAEMON_DOWN_MESSAGE = 'The daemon is down. Start it with npm run studio:daemon.';

async function readReply(response) {
  try {
    return await response.json();
  } catch (error) {
    console.error('Could not read the studio reply', error);
    return undefined;
  }
}

/**
 * Calls the studio API. Never throws: a network failure and an error reply both come back as
 * {ok: false, status, code, field, message}, with message in plain words for the Creator.
 */
export async function callApi(method, path, body) {
  const hasBody = body !== undefined;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: hasBody ? {'Content-Type': 'application/json'} : {},
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error('Studio request failed', error);
    return {ok: false, status: 0, code: 'daemon_down', message: DAEMON_DOWN_MESSAGE};
  }
  const reply = await readReply(response);
  if (response.ok) return {ok: true, status: response.status, data: reply};
  return {
    ok: false,
    status: response.status,
    code: reply?.code ?? 'unreadable',
    field: reply?.field,
    message: reply?.message ?? 'The studio sent a reply the page could not read.',
  };
}
