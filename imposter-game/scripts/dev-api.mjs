import { createServer } from 'node:http';

import handler from '../api/generate-round.ts';

const port = Number(process.env.API_PORT || 3000);

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

const createWebRequest = async (request) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (value) {
      headers.set(key, value);
    }
  }

  const method = request.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);
  const host = request.headers.host || `localhost:${port}`;

  return new Request(`http://${host}${request.url || '/'}`, {
    method,
    headers,
    body,
  });
};

const server = createServer(async (request, response) => {
  try {
    const webRequest = await createWebRequest(request);
    const webResponse = await handler.fetch(webRequest);
    const responseBody = Buffer.from(await webResponse.arrayBuffer());

    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    response.end(responseBody);
  } catch {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'API dev server error' }));
  }
});

server.listen(port, () => {
  console.log(`API dev server listening on http://localhost:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
