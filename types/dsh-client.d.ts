// The native DSH web host supplies this loader before injected client scripts.
interface Window {
  __ModuleLoader__: {
    load(module: {id: string; factory: (require: (name: string) => any) => any}): void;
  };
}
