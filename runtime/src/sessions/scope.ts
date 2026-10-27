export type BindingKind = "let" | "const" | "var" | "function" | "class";
export interface BindingDefinition {
  name: string;
  kind: BindingKind;
}

/** Accessors preserve live identity, temporal dead zones and const assignment rules. */
export class SessionBindings {
  readonly values = Object.create(null) as Record<string, unknown>;
  readonly initializers = Object.create(null) as Record<string, unknown>;
  private bindings = new Map<
    string,
    { kind: BindingKind; initialized: boolean; value: unknown }
  >();

  declare(definitions: BindingDefinition[]): void {
    for (const { name, kind } of definitions) {
      if (this.bindings.has(name)) continue;
      const binding = {
        kind,
        initialized: kind === "var",
        value: undefined as unknown,
      };
      this.bindings.set(name, binding);
      Object.defineProperty(this.values, name, {
        get() {
          if (!binding.initialized)
            throw new ReferenceError(
              `Cannot access '${name}' before initialization`,
            );
          return binding.value;
        },
        set(value: unknown) {
          if (!binding.initialized)
            throw new ReferenceError(
              `Cannot access '${name}' before initialization`,
            );
          if (binding.kind === "const")
            throw new TypeError(`Assignment to constant variable '${name}'`);
          binding.value = value;
        },
      });
      Object.defineProperty(this.initializers, name, {
        set(value: unknown) {
          if (binding.initialized && binding.kind === "const")
            throw new TypeError(`Duplicate initialization of '${name}'`);
          binding.value = value;
          binding.initialized = true;
        },
      });
    }
  }
}
