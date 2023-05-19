import { Context, MiddlewareHandler } from "hono";
import * as jose from "jose";

export interface RefreshTokenPayload {
  [key: string]: any;
  email: string;
  password: string;
  sisbot: {
    id: string;
    mac: string;
  };
}

export interface AccessTokenPayload {
  [key: string]: any;
  webcenterAccessToken: string;
  credentials: string;
}

export interface AuthPayload extends RefreshTokenPayload {
  webcenterAccessToken: string;
}

export const getPayload = (c: Context): AuthPayload | null => {
  const idToken = c.get("auth-payload");
  return idToken;
};

export const authMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const secret = c.env.secretKey as string;

    if (!c.req.headers.has("Authorization")) {
      return new Response(null, {
        status: 403,
      });
    }

    const token = c.req.headers.get("Authorization")!.split(" ")[1];
    try {
      const payload = await verifyAccessToken(token, secret);

      const credentialsPayload = await verifyRefreshToken(
        payload.credentials,
        secret
      );

      const authPayload = {
        ...credentialsPayload,
        webcenterAccessToken: payload.webcenterAccessToken,
      };

      c.set("auth-payload", authPayload);
      await next();
    } catch (e) {
      return new Response(null, {
        status: 401,
      });
    }
  };
};

export const generateRefreshToken = async (
  payload: RefreshTokenPayload,
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

export const generateAccessToken = async (
  payload: AccessTokenPayload,
  secret: string,
  expiry: string
): Promise<string> => {
  const sec = jose.base64url.decode(secret);

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("wcp")
    .setAudience("wcp")
    .setExpirationTime(expiry)
    .sign(sec);

  return jwt;
};

export const verifyRefreshToken = async function (
  token: string,
  secret: string
): Promise<RefreshTokenPayload> {
  const sec = jose.base64url.decode(secret);

  const { payload } = await jose.jwtDecrypt(token, sec, {
    issuer: "wcp",
    audience: "wcp",
  });

  if (Date.now() > (payload.exp ?? 0) * 1000) {
    throw new Error("Token expired, please refresh.");
  }

  return payload as RefreshTokenPayload;
};

export const verifyAccessToken = async (
  token: string,
  secret: string
): Promise<AccessTokenPayload> => {
  const sec = jose.base64url.decode(secret);

  const { payload, protectedHeader } = await jose.jwtVerify(token, sec, {
    issuer: "wcp",
    audience: "wcp",
  });

  return payload as AccessTokenPayload;
};
