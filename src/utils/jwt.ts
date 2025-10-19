import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

const SECRET: Secret = process.env.JWT_SECRET as string;
const EXPIRES_IN: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES ?? "1h") as SignOptions["expiresIn"];
const ISSUER = process.env.JWT_ISSUER || 'tern-backend';
const AUDIENCE = process.env.JWT_AUDIENCE || 'tern-api';

export type JwtPayload = { 
    uid: number; 
    email: string; 
    role: 'Admin' | 'Viewer' | 'Editor'; 
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, {
    expiresIn: EXPIRES_IN,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export const verifyToken = (token: string) => {
    return jwt.verify(token, SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;
}