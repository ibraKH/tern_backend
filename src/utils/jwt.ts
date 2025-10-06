import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

const SECRET: Secret = process.env.JWT_SECRET as string;
const EXPIRES_IN: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES ?? "7d") as SignOptions["expiresIn"];

export type JwtPayload = { 
    uid: number; 
    email: string; 
    role: 'Admin' | 'Viewer' | 'Editor'; 
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export const verifyToken = (token: string) => {
    return jwt.verify(token, SECRET) as JwtPayload;
}