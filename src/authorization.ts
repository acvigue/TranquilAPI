import { Context, MiddlewareHandler } from "hono";
import { User } from "./types";
import * as jose from "jose";

export interface TokenPayload {
  [key: string]: any;
  user: User;
}

export const getPayload = (c: Context): TokenPayload => {
  const idToken = JSON.parse(c.get("token-payload")!);
  return idToken;
};

export const authMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const secret = c.env.secretKey as string;

    let token = "";
    if (!c.req.headers.has("Authorization") && !c.req.query("auth_token")) {
      return new Response("Forbidden", {
        status: 403,
      });
    }

    if (c.req.headers.has("Authorization")) {
      token = c.req.headers.get("Authorization")!.split(" ")[1];
    } else {
      token = c.req.query("auth_token")!;
    }

    try {
      const payload = await verifyToken(token, secret);

      if (!payload.user.is_active) {
        return new Response("User inactive", {
          status: 401,
        });
      }

      c.set("token-payload", JSON.stringify(payload));
      await next();
    } catch (e) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }
  };
};

export const generateToken = async (
  payload: TokenPayload,
  secret: string,
  expiry: string
): Promise<string> => {
  const sec = jose.base64url.decode(secret);

  const token = await new jose.EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A128CBC-HS256" })
    .setIssuedAt()
    .setIssuer("wcp")
    .setAudience("wcp")
    .setExpirationTime(expiry)
    .encrypt(sec);

  return token;
};

export const verifyToken = async function (
  token: string,
  secret: string
): Promise<TokenPayload> {
  const sec = jose.base64url.decode(secret);

  const { payload } = await jose.jwtDecrypt(token, sec, {
    issuer: "wcp",
    audience: "wcp",
  });

  if (Date.now() > (payload.exp ?? 0) * 1000) {
    throw new Error("Token expired, please refresh.");
  }

  return payload as TokenPayload;
};
