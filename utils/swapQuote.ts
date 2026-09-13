/**
 * Pure swap quote engine: single source of truth for swap math.
 *
 * Dependency-free by design — no imports from hooks, store, or components —
 * so both the swap dialog preview and the position mutators share one formula.
 */

import BigNumber from "bignumber.js";

/** Protocol fee applied to the source USD value, in basis points. */
export const SWAP_FEE_BPS = 0;

/** Price-slippage buffer applied to the source USD value, in basis points. */
export const SWAP_SLIPPAGE_BPS = 10;

/** Side of the position being swapped. */
export type SwapSide = "RESERVE" | "BORROW";

/** Typed validation failures for a swap quote request. */
export type SwapError =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "SAME_ASSET"
  | "INELIGIBLE_DEST"
  | "MISSING_PRICE";

/** Quoted destination quantity plus its USD breakdown. */
export interface SwapQuote {
  usdValue: number;
  qtyDest: number;
  feeUsd: number;
  slippageUsd: number;
}

/** Optional per-call overrides and validation context for {@link calcSwapQuote}. */
export type SwapQuoteOpts = {
  feeBps?: number;
  slippageBps?: number;
  /** Source balance used to detect INSUFFICIENT_BALANCE. Omit to skip the check. */
  balanceSrc?: number;
  /** Source symbol used to detect SAME_ASSET. */
  srcSymbol?: string;
  /** Destination symbol used to detect SAME_ASSET. */
  dstSymbol?: string;
  /** Set false when the destination is ineligible on this side. */
  destEligible?: boolean;
};

type SwapQuoteResult = { quote: SwapQuote } | { error: SwapError };

const BPS_DIVISOR = 10_000;

/** Minimal asset shape needed for destination filtering and ordering. */
type SwapAssetLike = {
  symbol: string;
  isActive?: boolean;
  isFrozen?: boolean;
  isPaused?: boolean;
  borrowingEnabled?: boolean;
  usageAsCollateralEnabled?: boolean;
};

const STABLECOIN_SYMBOLS = [
  "DAI",
  "USDC",
  "USDT",
  "TUSD",
  "USDP",
  "BUSD",
  "FRAX",
  "LUSD",
  "SUSD",
  "GUSD",
  "USDD",
  "DUSD",
  "GHO",
  "USD",
  "EUR",
  "MAI",
  "USDE",
  "SUSDE",
  "EUSDE",
  "EURT",
  "EURS",
  "AGEUR",
  "PAR",
];

const isStablecoinSymbol = (symbol: string): boolean => {
  const upper = symbol.toUpperCase();
  return STABLECOIN_SYMBOLS.some((stable) => upper.includes(stable));
};

const isActive = (asset: SwapAssetLike): boolean =>
  !!asset.isActive && !asset.isPaused && !asset.isFrozen;

const isEligibleForSide = (asset: SwapAssetLike, side: SwapSide): boolean => {
  if (!isActive(asset)) return false;
  return side === "RESERVE"
    ? !!asset.usageAsCollateralEnabled
    : !!asset.borrowingEnabled;
};

/**
 * Convert a source amount to a destination quantity at working prices,
 * subtracting fee and slippage from the source USD value.
 */
export const calcSwapQuote = (
  amountSrc: number,
  priceSrc: number,
  priceDest: number,
  opts: SwapQuoteOpts = {},
): SwapQuoteResult => {
  if (!Number.isFinite(amountSrc) || amountSrc <= 0) {
    return { error: "INVALID_AMOUNT" };
  }
  if (
    opts.srcSymbol !== undefined &&
    opts.dstSymbol !== undefined &&
    opts.srcSymbol === opts.dstSymbol
  ) {
    return { error: "SAME_ASSET" };
  }
  if (opts.destEligible === false) {
    return { error: "INELIGIBLE_DEST" };
  }
  if (!Number.isFinite(priceDest) || priceDest <= 0) {
    return { error: "MISSING_PRICE" };
  }
  if (
    opts.balanceSrc !== undefined &&
    Number.isFinite(opts.balanceSrc) &&
    amountSrc > opts.balanceSrc
  ) {
    return { error: "INSUFFICIENT_BALANCE" };
  }

  const feeBps = opts.feeBps ?? SWAP_FEE_BPS;
  const slippageBps = opts.slippageBps ?? SWAP_SLIPPAGE_BPS;

  const srcValue = new BigNumber(amountSrc).multipliedBy(
    Number.isFinite(priceSrc) && priceSrc > 0 ? priceSrc : 0,
  );
  const feeUsd = srcValue.multipliedBy(feeBps).dividedBy(BPS_DIVISOR);
  const slippageUsd = srcValue.multipliedBy(slippageBps).dividedBy(BPS_DIVISOR);
  const netUsd = srcValue.minus(feeUsd).minus(slippageUsd);
  const qtyDest = netUsd.dividedBy(priceDest);

  return {
    quote: {
      usdValue: srcValue.toNumber(),
      qtyDest: qtyDest.toNumber(),
      feeUsd: feeUsd.toNumber(),
      slippageUsd: slippageUsd.toNumber(),
    },
  };
};

/**
 * Filter the available-asset catalog to valid swap destinations for one side,
 * excluding the source symbol. Ordered USDC first, then stablecoins, then
 * alphabetically by symbol.
 */
export const getSwapDestinations = <T extends SwapAssetLike>(
  available: readonly T[],
  side: SwapSide,
  excludeSymbol: string,
): T[] =>
  available
    .filter(
      (asset) =>
        asset.symbol !== excludeSymbol && isEligibleForSide(asset, side),
    )
    .sort((a, b) => {
      const aIsUsdc = a.symbol === "USDC" ? 0 : 1;
      const bIsUsdc = b.symbol === "USDC" ? 0 : 1;
      if (aIsUsdc !== bIsUsdc) return aIsUsdc - bIsUsdc;
      const aIsStable = isStablecoinSymbol(a.symbol) ? 0 : 1;
      const bIsStable = isStablecoinSymbol(b.symbol) ? 0 : 1;
      if (aIsStable !== bIsStable) return aIsStable - bIsStable;
      return a.symbol.localeCompare(b.symbol);
    });
