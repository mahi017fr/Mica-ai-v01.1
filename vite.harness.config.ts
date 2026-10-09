// TEMPORARY — local layout test harness config. Deleted after testing.
import { defineConfig } from 'vite';
import base from './vite.config';

const MOCK = '/src/__harness__/mocks.tsx';

export default defineConfig(async (env: any) => {
  const cfg: any = (base as any)(env);
  const resolved = cfg && typeof cfg.then === 'function' ? await cfg : cfg;
  const alias = resolved?.resolve?.alias ?? {};
  const aliasList: any[] = Array.isArray(alias)
    ? alias
    : Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));

  return {
    ...resolved,
    resolve: {
      ...resolved.resolve,
      alias: [
        ...aliasList,
        { find: /context\/ChatContext$/, replacement: MOCK },
        { find: /context\/CallContext$/, replacement: MOCK },
        { find: /context\/BlockContext$/, replacement: MOCK },
        { find: /context\/CurrencyContext$/, replacement: MOCK },
        { find: /hooks\/usePrimaryWallet$/, replacement: MOCK },
      ],
    },
  };
});
