const implementation =
  typeof Bun === "undefined" ? await import("@node-rs/argon2") : null;

export const password = {
  hash(value: string): Promise<string> {
    if (implementation) {
      return implementation.hash(value, {
        memoryCost: 65_536,
        timeCost: 2,
        parallelism: 1,
      });
    }
    return Bun.password.hash(value);
  },
  verify(value: string, hash: string): Promise<boolean> {
    if (implementation) {
      return implementation.verify(hash, value);
    }
    return Bun.password.verify(value, hash);
  },
};
