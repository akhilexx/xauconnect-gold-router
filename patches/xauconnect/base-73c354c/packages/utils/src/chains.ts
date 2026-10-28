/**
 * XAUConnect — Multi-chain registry.
 *
 * Single source of truth for every chain the aggregator supports.
 * Adding a chain here automatically propagates to the backend routing engine,
 * the web chain selector, and the SDK.
 *
 * NOTE [own-network provisioning]: when XAUConnect launches its own L1/L2,
 * register it here with `kind: "evm"` and point `rpcEnvKey` at the new RPC.
 * The XAU token can then act as the native gas token transparently.
 */

export type ChainKind = "evm" | "solana";

/** EVM chains use their numeric chain id; non-EVM chains use a string key. */
export type ChainId = number | "solana";

export interface ChainInfo {
  /** Canonical id — numeric for EVM, string for non-EVM. */
  id: ChainId;
  /** Stable lowercase key used in API routes and env vars. */
  key: string;
  name: string;
  kind: ChainKind;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerUrl: string;
  /** Env var that overrides the default public RPC. */
  rpcEnvKey: string;
  defaultRpc: string;
  /** Brand color used by the chain selector UI. */
  color: string;
  /** Wrapped-native token address (WETH/WBNB/...); undefined on Solana. */
  wrappedNative?: string;
  /** Canonical USDC address/mint for fee payment + quoting. */
  usdc?: string;
  testnet?: boolean;
}

export const CHAINS: readonly ChainInfo[] = [
  {
    id: 1,
    key: "ethereum",
    name: "Ethereum",
    kind: "evm",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorerUrl: "https://etherscan.io",
    rpcEnvKey: "RPC_ETHEREUM",
    defaultRpc: "https://eth.llamarpc.com",
    color: "#627EEA",
    wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  {
    id: 56,
    key: "bsc",
    name: "BNB Chain",
    kind: "evm",
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    explorerUrl: "https://bscscan.com",
    rpcEnvKey: "RPC_BSC",
    defaultRpc: "https://bsc-dataseed.binance.org",
    color: "#F0B90B",
    wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
  {
    id: 137,
    key: "polygon",
    name: "Polygon",
    kind: "evm",
    nativeSymbol: "POL",
    nativeDecimals: 18,
    explorerUrl: "https://polygonscan.com",
    rpcEnvKey: "RPC_POLYGON",
    defaultRpc: "https://polygon-bor-rpc.publicnode.com",
    color: "#8247E5",
    wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  {
    id: 42161,
    key: "arbitrum",
    name: "Arbitrum One",
    kind: "evm",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorerUrl: "https://arbiscan.io",
    rpcEnvKey: "RPC_ARBITRUM",
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    color: "#28A0F0",
    wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  {
    id: 8453,
    key: "base",
    name: "Base",
    kind: "evm",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorerUrl: "https://basescan.org",
    rpcEnvKey: "RPC_BASE",
    defaultRpc: "https://mainnet.base.org",
    color: "#0052FF",
    wrappedNative: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    id: 43114,
    key: "avalanche",
    name: "Avalanche C-Chain",
    kind: "evm",
    nativeSymbol: "AVAX",
    nativeDecimals: 18,
    explorerUrl: "https://snowtrace.io",
    rpcEnvKey: "RPC_AVALANCHE",
    defaultRpc: "https://api.avax.network/ext/bc/C/rpc",
    color: "#E84142",
    wrappedNative: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
  {
    id: "solana",
    key: "solana",
    name: "Solana",
    kind: "solana",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    explorerUrl: "https://solscan.io",
    rpcEnvKey: "RPC_SOLANA",
    defaultRpc: "https://api.mainnet-beta.solana.com",
    color: "#9945FF",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
] as const;

const byKey = new Map(CHAINS.map((c) => [c.key, c]));
const byId = new Map(CHAINS.map((c) => [c.id, c]));

export function getChainByKey(key: string): ChainInfo | undefined {
  return byKey.get(key);
}

export function getChainById(id: ChainId): ChainInfo | undefined {
  return byId.get(id);
}

export const EVM_CHAINS = CHAINS.filter((c) => c.kind === "evm");
export const CHAIN_KEYS = CHAINS.map((c) => c.key);

/** Pseudo-address representing the native coin in quote requests (EVM convention). */
export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** Solana wrapped SOL mint, used as the native marker on Solana. */
export const SOLANA_NATIVE_MINT = "So11111111111111111111111111111111111111112";

export function isNativeToken(chain: ChainInfo, address: string): boolean {
  if (chain.kind === "solana") return address === SOLANA_NATIVE_MINT;
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}
