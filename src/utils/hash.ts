import bcrypt from "bcrypt";

export const hash = async (plain: string) => {
    return bcrypt.hash(plain + (process.env.BCRYPT_PEPPER || ""), Number(process.env.BCRYPT_SALT_ROUNDS || 12));
}

export const verify = async (plain: string, digest: string) => {
    return bcrypt.compare(plain + (process.env.BCRYPT_PEPPER || ""), digest);
}