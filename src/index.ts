/**
 * Welcome to Cloudflare Workers! This is *not* your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import * as auth from "./authorization";
import webcenter from "./webcenter";

type AppEnv = {
  storageBucket: R2Bucket;
  secretKey: string;
};

const dryRunAuth = true;

const app = new Hono<{ Bindings: AppEnv }>();

app.use("*", cors(), poweredBy());

app.get("/", (c) => c.redirect("https://www.youtube.com/watch?v=FfnQemkjPjM"));

app.get("/track/:id/download", auth.authMiddleware(), async (c) => {
  const authPayload = auth.getPayload(c);

  if (authPayload === null) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const trackID = c.req.param("id");
  const objectName = `${trackID}.thr`;
  const object = await c.env.storageBucket.get(objectName);
  if (object === null) {
    return c.json({ error: "Not Found" }, 404);
  }

  const objectContent = await object.text();
  c.header("Content-Type", "text/plain");
  c.header("Cache-Control", "max-age=31536000");

  console.log(
    `[Track Download] User ${
      authPayload.email
    } downloaded track ${trackID} from IP: ${c.req.headers.get(
      "CF-Connecting-IP"
    )}`
  );

  return c.body(objectContent);
});

app.post("/auth/getRefreshToken", async (c) => {
  const body = await c.req.json<auth.RefreshTokenPayload>();

  if (!body.email || !body.password || !body.sisbot) {
    return c.json({ error: "Malformed request" }, 400);
  }

  //We don't even need to use the auth token here, just make sure the user's credentials are valid!
  if (!dryRunAuth) {
    try {
      await webcenter.auth_user({
        email: body.email,
        password: body.password,
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  }

  const token = await auth.generateRefreshToken(body, c.env.secretKey, "10y");

  return c.json(
    {
      refreshToken: token,
    },
    200
  );
});

app.post("/auth/getAccessToken", async (c) => {
  const body = await c.req.json<{ refreshToken: string }>();
  if (!body.refreshToken) {
    return c.json({ error: "Malformed request" }, 400);
  }

  let payload;
  try {
    payload = await auth.verifyRefreshToken(body.refreshToken, c.env.secretKey);
  } catch (e) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    let webcenterAccessToken = "test";

    if (!dryRunAuth) {
      const authUserResponse = await webcenter.auth_user({
        email: payload.email,
        password: payload.password,
      });
      webcenterAccessToken = authUserResponse.auth_token;
    }

    const accessTokenPayload = {
      webcenterAccessToken: webcenterAccessToken,
      credentials: body.refreshToken,
    };

    const accessToken = await auth.generateAccessToken(
      accessTokenPayload,
      c.env.secretKey,
      "1h"
    );

    return c.json({ accessToken: accessToken }, 200);
  } catch (e) {
    return c.json({ error: getErrorMessage(e) }, 500);
  }
});

function getErrorMessage(e: any) {
  let message;
  if (e instanceof Error) message = e.message;
  else message = String(e);
  return message;
}

export default app;
