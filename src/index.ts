/*
    TranquilAPI Worker
    Part of the Tranquil Project

    Copyright 2023 - Aiden Vigue
    Licensed under GNU GPL-v3
*/

import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import * as auth from "./authorization";

export interface Pattern {
  uuid: string;
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
};

const app = new Hono<{ Bindings: AppEnv }>();

app.use("*", cors(), poweredBy());

app.get("/", (c) => c.redirect("https://www.youtube.com/watch?v=FfnQemkjPjM"));

app.post("/playlists", auth.authMiddleware(), async (c) => {
  const tokenPayload = auth.getPayload(c);
  if (!tokenPayload.user.is_admin) {
    return c.json({ error: "User not admin!" }, 403);
  }

  const newPlaylist = await c.req.json<Playlist>();
  const playlists = await getPlaylists(c);
  playlists.unshift(newPlaylist);

  const playlistsUnique = [
    ...new Map(playlists.map((playlist) => [playlist.uuid, playlist])).values(),
  ];

  const objectName = `playlists.json`;
  try {
    await c.env.tranquilStorage.put(
      objectName,
      JSON.stringify(playlistsUnique)
    );
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
  const tokenPayload = auth.getPayload(c);
  if (!tokenPayload.user.is_admin) {
    return c.json({ error: "User not admin!" }, 403);
  }

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
  interface AuthRequestBody {
    email: string;
    password: string;
  }

  const body = await c.req.json<AuthRequestBody>();

  if (!body.email || !body.password) {
    return c.json({ error: "Malformed request" }, 400);
  }

  const usersFile = await c.env.tranquilStorage.get("users.json");
  if (!usersFile) {
    return c.json({ error: "Couldn't retrieve users database!" }, 400);
  }
  const users = (await usersFile.json()) as auth.User[];

  const thisUser = users.find((user) => {
    return user.email === body.email;
  });

  if (!thisUser || body.password !== thisUser.password) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const tokenPayload = {
    user: thisUser,
  };

  const token = await auth.generateToken(tokenPayload, c.env.secretKey, "10y");

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
