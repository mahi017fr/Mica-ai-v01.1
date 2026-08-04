import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';
import {Contract, JsonRpcProvider, formatUnits, getAddress} from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function arcBalanceApi() {
  const chainId = 5042002;
  const usdc = '0x3600000000000000000000000000000000000000';
  const provider = new JsonRpcProvider(process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io', chainId, {staticNetwork: true});
  const contract = new Contract(usdc, ['function balanceOf(address) view returns (uint256)'], provider);
  const middleware = async (req: any, res: any, next: any) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/arc-usdc-balance') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const wallet = getAddress(url.searchParams.get('address') || '');
      const raw = await contract.balanceOf(wallet);
      res.statusCode = 200;
      res.end(JSON.stringify({ok: true, wallet, chainId, contract: usdc, rawBalance: raw.toString(), balance: formatUnits(raw, 6), decimals: 6}));
    } catch (error: any) {
      res.statusCode = 502;
      res.end(JSON.stringify({ok: false, error: error?.message || 'Arc RPC request failed'}));
    }
  };
  return {
    name: 'arc-usdc-balance-api',
    configureServer(server: any) { server.middlewares.use(middleware); },
    configurePreviewServer(server: any) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(() => {
  return {
    plugins: [arcBalanceApi(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
