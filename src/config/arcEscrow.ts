// DealEscrowFactory configuration.
//
// The escrow factory + per-deal escrow contracts live on Arc Network testnet
// (chain 5042002). The factory ADDRESS is public contract metadata (not a
// secret), so it can live in a Vite env var or here. When it is null the app
// runs in `seam` custody mode: the full workflow works, funding legs are
// recorded as real wallet-signed transactions against a per-deal escrow record,
// and the UI is explicit that on-chain custody settlement is not live yet.
//
// Keys are NEVER stored in this repo or the frontend — a deployer key is only
// used once by scripts/deploy-escrow.mjs on the machine that deploys.

const ENV_FACTORY =
  typeof import.meta !== "undefined"
    ? ((import.meta as any).env as any)?.VITE_ESCROW_FACTORY_ADDRESS
    : undefined;

export const ARC_ESCROW_FACTORY_ADDRESS: string | null = (ENV_FACTORY as string | undefined)
  ? String(ENV_FACTORY).trim().toLowerCase()
  : null;

export function escrowCustodyMode(): "contract" | "seam" {
  return ARC_ESCROW_FACTORY_ADDRESS ? "contract" : "seam";
}

// Minimal USDC ERC-20 surface used for approvals before deposits.
export const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

export const DEAL_ESCROW_FACTORY_ABI = [
  "function createDeal(uint256 dealId, address buyer, address seller, uint256 amount, uint256 collateral, address arbiter) returns (address escrow)",
  "function usdc() view returns (address)",
  "event DealCreated(uint256 indexed dealId, address escrow)",
] as const;

export const DEAL_ESCROW_ABI = [
  "function deposit()",
  "function startReviewPeriod()",
  "function buyerRelease()",
  "function autoRelease()",
  "function dispute()",
  "function refund()",
  "function settle(uint256 sellerAmount, uint256 buyerAmount)",
  "function buyer() view returns (address)",
  "function seller() view returns (address)",
  "function arbiter() view returns (address)",
  "function usdc() view returns (address)",
  "function amount() view returns (uint256)",
  "function collateral() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function funded() view returns (bool)",
  "function released() view returns (bool)",
  "function disputed() view returns (bool)",
  "function reviewStarted() view returns (bool)",
  "function totalDeposited() view returns (uint256)",
  "function deposited(address) view returns (uint256)",
  "event Funded(address who, uint256 amount)",
  "event ReviewStarted(uint256 deadline)",
  "event Released(uint256 sellerAmount, uint256 collateralReturn)",
  "event Disputed(address by)",
  "event Settled(address to, uint256 amount)",
] as const;

// DealEscrowFactory ABI used by the deploy script (duplicated for Node without
// import.meta). Kept in sync with contracts/DealEscrow.sol.
export const FACTORY_ABI_FOR_DEPLOY = [
  "function createDeal(uint256 dealId, address buyer, address seller, uint256 amount, uint256 collateral, address arbiter) returns (address escrow)",
] as const;
