/**
 * Welcome to Cloudflare Workers! This is *not* your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import * as auth from "./authorization";

export interface Pattern {
  uuid: string; //uuid
  name: string;
  date: string;
}

interface PostPatternBody {
  data: string;
  pattern: Pattern;
}

export interface Playlist {
  uuid: string;
  name: string;
  description: string;
  patterns: string[];
  featured_pattern: string;
  date: string;
}

type AppEnv = {
  tranquilStorage: R2Bucket;
  secretKey: string;
  email: string;
  password: string;
};

const app = new Hono<{ Bindings: AppEnv }>();

app.use("*", cors(), poweredBy());

app.get("/", (c) => c.redirect("https://github.com/acvigue/TranquilAPI"));

app.post("/playlists", auth.authMiddleware(), async (c) => {
  const newPlaylist = await c.req.json<Playlist>();
  const playlists = await getPlaylists(c);
  playlists.unshift(newPlaylist);

  const playlistsUnique = [
    ...new Map(playlists.map((playlist) => [playlist.uuid, playlist])).values(),
  ];

  const objectName = `playlists.json`;
  try {
    await c.env.tranquilStorage.put(objectName, JSON.stringify(playlistsUnique));
  } catch (e) {
    return c.json({ error: "R2 write error" }, 500);
  }
  return c.json({ uuid: newPlaylist.uuid });
});

app.get("/playlists", auth.authMiddleware(), async (c) => {
  const playlists = await getPlaylists(c);
  return c.json(playlists);
});

app.get("/playlists/:uuid", auth.authMiddleware(), async (c) => {
  const playlist_uuid = c.req.param("uuid");
  const playlists = await getPlaylists(c);
  const playlist = playlists.find((v) => v.uuid === playlist_uuid);

  if (!playlist) {
    return c.json({ error: "Not Found" }, 404);
  }

  c.header("Cache-Control", "max-age=31536000");
  return c.json(playlist);
});

app.post("/patterns", auth.authMiddleware(), async (c) => {
  const newPatternBody = await c.req.json<PostPatternBody>();

  try {
    const objectName = `patterns/${newPatternBody.pattern.uuid}`;
    await c.env.tranquilStorage.put(objectName, newPatternBody.data);
  } catch (e) {
    console.log(e);
    return c.json({ error: "Couldn't store pattern!" }, 404);
  }

  const patterns = await getPatterns(c);
  patterns.unshift(newPatternBody.pattern);

  const patternsUnique = [
    ...new Map(patterns.map((pattern) => [pattern.uuid, pattern])).values(),
  ];

  const objectName = `patterns.json`;
  try {
    await c.env.tranquilStorage.put(objectName, JSON.stringify(patternsUnique));
  } catch (e) {
    return c.json({ error: "R2 write error" }, 500);
  }
  return c.json({ uuid: newPatternBody.pattern.uuid });
});

app.get("/patterns", auth.authMiddleware(), async (c) => {
  const patterns = await getPatterns(c);
  return c.json(patterns);
});

app.get("/patterns/:uuid", auth.authMiddleware(), async (c) => {
  const pattern_uuid = c.req.param("uuid");
  const patterns = await getPatterns(c);
  const pattern = patterns.find((v) => v.uuid === pattern_uuid);

  if (!pattern) {
    return c.json({ error: "Not Found" }, 404);
  }

  c.header("Cache-Control", "max-age=31536000");
  return c.json(pattern);
});

app.get("/patterns/:uuid/data", auth.authMiddleware(), async (c) => {
  const pattern_uuid = c.req.param("uuid");
  const objectName = `patterns/${pattern_uuid}`;
  const object = await c.env.tranquilStorage.get(objectName);
  if (object === null) {
    return c.json({ error: "Not Found" }, 404);
  }

  const objectContent = await object.text();
  c.header("Content-Type", "text/plain");
  c.header("Cache-Control", "max-age=31536000");

  return c.body(objectContent);
});

app.post("/auth", async (c) => {
  const body = await c.req.json<auth.TokenPayload>();

  if (!body.email || !body.password) {
    return c.json({ error: "Malformed request" }, 400);
  }

  if (body.email !== c.env.email || body.password !== c.env.password) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = await auth.generateToken(body, c.env.secretKey, "10y");

  return c.json({
    token,
  });
});

async function getPatterns(c: Context): Promise<Pattern[]> {
  const objectName = `patterns.json`;
  const object = await c.env.tranquilStorage.get(objectName);
  if (object === null) {
    throw new Error("Object not found");
  }
  const objectContent = await object.json();
  return objectContent as Pattern[];
}

async function getPlaylists(c: Context): Promise<Playlist[]> {
  const objectName = `playlists.json`;
  const object = await c.env.tranquilStorage.get(objectName);
  if (object === null) {
    throw new Error("Object not found");
  }
  const objectContent = await object.json();
  return objectContent as Playlist[];
}

export default app;
