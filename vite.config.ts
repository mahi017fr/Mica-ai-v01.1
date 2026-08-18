import { config as loadEnv } from 'dotenv';
loadEnv();

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';
import {Contract, JsonRpcProvider, formatUnits, getAddress} from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function logDiag(entry: Record<string, unknown>) {
  console.log('[WALLET_DIAG]', JSON.stringify(entry));
}

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

function walletEnsureApi() {
  // One-time startup diagnostic: which env vars are visible to the Vite process?
  console.log('[WALLET_DIAG] {"step":"plugin_startup","FIREBASE_PROJECT_ID_SET":' + Boolean(process.env.FIREBASE_PROJECT_ID) + ',"FIREBASE_CLIENT_EMAIL_SET":' + Boolean(process.env.FIREBASE_CLIENT_EMAIL) + ',"FIREBASE_PRIVATE_KEY_SET":' + Boolean(process.env.FIREBASE_PRIVATE_KEY) + ',"CIRCLE_API_KEY_SET":' + Boolean(process.env.CIRCLE_API_KEY) + ',"CIRCLE_ENTITY_SECRET_SET":' + Boolean(process.env.CIRCLE_ENTITY_SECRET) + ',"CIRCLE_WALLET_SET_ID_SET":' + Boolean(process.env.CIRCLE_WALLET_SET_ID) + '}');

  const middleware = async (req: any, res: any, next: any) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/wallet/ensure' || req.method !== 'POST') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      // Read the raw body for Authorization header (passed via fetch headers).
      const authHeader = req.headers?.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!idToken) {
        res.statusCode = 401;
        res.end(JSON.stringify({ok: false, error: 'Missing Firebase ID token.'}));
        return;
      }
      logDiag({ step: 'received_request', hasAuth: Boolean(authHeader.startsWith('Bearer ')), idTokenLen: idToken.length, circleApiKeySet: Boolean(process.env.CIRCLE_API_KEY), entitySecretSet: Boolean(process.env.CIRCLE_ENTITY_SECRET), walletSetIdSet: Boolean(process.env.CIRCLE_WALLET_SET_ID), FIREBASE_PROJECT_ID_SET: Boolean(process.env.FIREBASE_PROJECT_ID), FIREBASE_CLIENT_EMAIL_SET: Boolean(process.env.FIREBASE_CLIENT_EMAIL), FIREBASE_PRIVATE_KEY_SET: Boolean(process.env.FIREBASE_PRIVATE_KEY) });

      const { handleEnsureWallet } = await import('./src/server/circleWalletService');
      const wallet = await handleEnsureWallet(idToken);
      logDiag({ step: 'wallet_ensured_ok', address: wallet.address, walletId: wallet.walletId, blockchain: wallet.blockchain, state: wallet.state });
      res.statusCode = 200;
      res.end(JSON.stringify({
        ok: true,
        wallet: {
          walletId: wallet.walletId,
          address: wallet.address,
          blockchain: wallet.blockchain,
          state: wallet.state,
          ensuredAt: wallet.ensuredAt,
        },
      }));
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error('[POST /api/wallet/ensure] Error:', message);
      logDiag({ step: 'caught_exception', message: String(message).slice(0, 300), name: error?.name, stackSnippet: error?.stack ? String(error.stack).slice(0, 400) : null });
      if (message.includes('not configured') || message.includes('not initialized')) {
        res.statusCode = 500;
        res.end(JSON.stringify({ok: false, error: `Server configuration error: ${String(message).slice(0, 120)}`}));
      } else if (message.includes('verifyIdToken') || message.includes('auth/')) {
        res.statusCode = 401;
        res.end(JSON.stringify({ok: false, error: 'Invalid Firebase ID token.'}));
      } else {
        res.statusCode = 500;
        res.end(JSON.stringify({ok: false, error: `Wallet ensure failed: ${String(message).slice(0, 120)}`}));
      }
    }
  };
  return {
    name: 'wallet-ensure-api',
    configureServer(server: any) { server.middlewares.use(middleware); },
    configurePreviewServer(server: any) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(() => {
  return {
    plugins: [arcBalanceApi(), walletEnsureApi(), react(), tailwindcss()],
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
