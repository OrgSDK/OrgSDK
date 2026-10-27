export class SessionRedactor {
  private readonly capabilities = new Set<string>();

  constructor(
    private readonly redactInstallationSecrets?: (value: unknown) => unknown,
  ) {}

  remember(capability?: string): void {
    if (capability) this.capabilities.add(capability);
  }

  private text(input: string): string {
    for (const capability of this.capabilities)
      input = input.replaceAll(capability, "[redacted]");
    return input;
  }

  redact(value: unknown): unknown {
    if (value === undefined) return undefined;
    const protectedValue = JSON.parse(
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === "string") return this.text(item);
        if (item && typeof item === "object" && !Array.isArray(item))
          return Object.fromEntries(
            Object.entries(item).map(([key, entry]) => [this.text(key), entry]),
          );
        return item;
      }),
    ) as unknown;
    return this.redactInstallationSecrets
      ? this.redactInstallationSecrets(protectedValue)
      : protectedValue;
  }
}
