// Deploy the DealEscrowFactory to Arc Network (testnet 5042002).
//
// Usage:
//   npm i -D solc
//   $env:DEPLOYER_PRIVATE_KEY="0x..."   (or add to .env)
//   $env:ARC_RPC_URL="https://rpc.testnet.arc.io"
//   node scripts/deploy-escrow.mjs
//
// The deployer private key is used ONLY here, at deploy time, on the machine
// running this script. It is never stored in the repo, frontend, or Firestore.
//
// After a successful deploy, set VITE_ESCROW_FACTORY_ADDRESS=<address> in the
// frontend environment to switch the app from `seam` custody mode to real
// on-chain custody.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000"; // Arc USDC (native gas token via ERC-20 iface)
const ARBITER_ZERO = "0x0000000000000000000000000000000000000000";
const REVIEW_WINDOW_SECONDS = 24 * 60 * 60; // 24h timelock

const SRC_PATH = path.join(__dirname, "..", "contracts", "DealEscrow.sol");

function compile() {
  const source = readFileSync(SRC_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "DealEscrow.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    for (const err of output.errors) {
      if (err.severity === "error") console.error(`[solc] ${err.formattedMessage}`);
    }
    const fatal = output.errors.some((e) => e.severity === "error");
    if (fatal) process.exit(1);
  }

  return output.contracts["DealEscrow.sol"];
}

async function main() {
  const contracts = compile();
  const factory = contracts["DealEscrowFactory"];
  const escrow = contracts["DealEscrow"];

  console.log(`Compiled DealEscrow (${escrow.evm.bytecode.object.length / 2 - 1} bytes) + DealEscrowFactory.`);

  // Compile-only validation never reads deployment credentials, connects to
  // Arc, constructs a wallet, or sends a transaction.
  if (process.argv.includes("--compile-only")) {
    console.log("Compile-only validation succeeded. No deployment was attempted.");
    return;
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error(
      "DEPLOYER_PRIVATE_KEY is required. Set it in the environment or .env:\n" +
        '  $env:DEPLOYER_PRIVATE_KEY="0x..."  (or add DEPLOYER_PRIVATE_KEY= to .env)'
    );
    process.exit(1);
  }

  const provider = new JsonRpcProvider(ARC_RPC_URL, ARC_CHAIN_ID);
  const network = await provider.getNetwork();
  console.log(`Connected to Arc RPC: ${ARC_RPC_URL}`);
  console.log(`Chain ID: ${network.chainId} (expected ${ARC_CHAIN_ID})`);
  if (Number(network.chainId) !== ARC_CHAIN_ID) {
    console.error("Mismatched chain id — aborting deploy.");
    process.exit(1);
  }

  const wallet = new Wallet(privateKey, provider);
  console.log(`Deployer: ${wallet.address}`);

  const factoryAbi = factory.abi;
  const bytecode = `0x${factory.evm.bytecode.object}`;

  // Sanity check: the escrow bytecode is not empty.
  if (!escrow.evm.bytecode.object || escrow.evm.bytecode.object.length < 100) {
    console.error("Escrow contract bytecode is empty — aborting.");
    process.exit(1);
  }

  console.log("Deploying DealEscrowFactory…");
  const cf = new ContractFactory(factoryAbi, bytecode, wallet);
  const deployed = await cf.deploy(
    ARC_USDC_ADDRESS,
    ARBITER_ZERO,
    REVIEW_WINDOW_SECONDS
  );
  await deployed.waitForDeployment();
  const factoryAddress = await deployed.getAddress();

  console.log("\n===== DEAL ESCROW FACTORY DEPLOYED =====");
  console.log(`Address:      ${factoryAddress}`);
  console.log(`Transaction:  ${deployed.deploymentTransaction().hash}`);
  console.log(`USDC:         ${ARC_USDC_ADDRESS}`);
  console.log(`Arbiter:      ${ARBITER_ZERO} (none — settle() disabled)`);
  console.log(`ReviewWindow: ${REVIEW_WINDOW_SECONDS}s (24h timelock)`);
  console.log("\nNext steps:");
  console.log(`  1. Set VITE_ESCROW_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  2. Update .env / Vite env, restart the app, and re-open the deal workflow.`);
  console.log("     The workflow switches from `seam` custody to real on-chain escrow.");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
