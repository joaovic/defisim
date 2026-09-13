import BigNumber from "bignumber.js";
import {
  SWAP_FEE_BPS,
  SWAP_SLIPPAGE_BPS,
  calcSwapQuote,
  getSwapDestinations,
} from "../../utils/swapQuote";

const asset = (symbol: string, overrides = {}) => ({
  symbol,
  name: symbol,
  priceInUSD: 1,
  priceInMarketReferenceCurrency: 1,
  baseLTVasCollateral: 8000,
  isActive: true,
  isFrozen: false,
  isPaused: false,
  reserveLiquidationThreshold: 8500,
  reserveFactor: 1000,
  usageAsCollateralEnabled: true,
  initialPriceInUSD: 1,
  borrowingEnabled: true,
  ...overrides,
});

describe("swap constants", () => {
  it("exports the fixed fee and slippage", () => {
    expect(SWAP_FEE_BPS).toBe(0);
    expect(SWAP_SLIPPAGE_BPS).toBe(10);
  });
});

describe("calcSwapQuote", () => {
  it("converts WBTC amount to USDC with fee and slippage applied", () => {
    const amountSrc = 0.5;
    const priceSrc = 60000;
    const priceDest = 1;
    const result = calcSwapQuote(amountSrc, priceSrc, priceDest);
    expect("quote" in result && result.quote).toBeTruthy();
    if (!("quote" in result)) return;
    const gross = new BigNumber(amountSrc).multipliedBy(priceSrc);
    const expectedFee = gross.multipliedBy(SWAP_FEE_BPS).dividedBy(10000);
    const expectedSlippage = gross
      .multipliedBy(SWAP_SLIPPAGE_BPS)
      .dividedBy(10000);
    const expectedQty = gross
      .minus(expectedFee)
      .minus(expectedSlippage)
      .dividedBy(priceDest);
    expect(result.quote.usdValue).toBeCloseTo(gross.toNumber(), 8);
    expect(result.quote.feeUsd).toBeCloseTo(expectedFee.toNumber(), 8);
    expect(result.quote.slippageUsd).toBeCloseTo(
      expectedSlippage.toNumber(),
      8,
    );
    expect(result.quote.qtyDest).toBeCloseTo(expectedQty.toNumber(), 8);
  });

  it("converts a full-balance MAX amount without rounding negative", () => {
    const balance = 1.23456789;
    const result = calcSwapQuote(balance, 3000, 1, { balanceSrc: balance });
    expect("quote" in result).toBe(true);
    if (!("quote" in result)) return;
    expect(result.quote.qtyDest).toBeGreaterThan(0);
    expect(Number.isFinite(result.quote.qtyDest)).toBe(true);
  });

  it("returns MISSING_PRICE for zero destination price", () => {
    expect(calcSwapQuote(1, 100, 0)).toEqual({ error: "MISSING_PRICE" });
  });

  it("returns MISSING_PRICE for negative destination price", () => {
    expect(calcSwapQuote(1, 100, -5)).toEqual({ error: "MISSING_PRICE" });
  });

  it("lets opts overrides replace the exported constants", () => {
    const base = calcSwapQuote(1, 1000, 1);
    const custom = calcSwapQuote(1, 1000, 1, {
      feeBps: 30,
      slippageBps: 50,
    });
    expect("quote" in base && "quote" in custom).toBe(true);
    if (!("quote" in base) || !("quote" in custom)) return;
    expect(custom.quote.feeUsd).toBeCloseTo(3, 8);
    expect(custom.quote.slippageUsd).toBeCloseTo(5, 8);
    expect(custom.quote.qtyDest).toBeCloseTo(992, 8);
    expect(base.quote.qtyDest).not.toBeCloseTo(custom.quote.qtyDest, 8);
  });

  it("triggers each remaining error code on its invalid input", () => {
    expect(calcSwapQuote(0, 100, 1)).toEqual({ error: "INVALID_AMOUNT" });
    expect(calcSwapQuote(-2, 100, 1)).toEqual({ error: "INVALID_AMOUNT" });
    expect(calcSwapQuote(NaN, 100, 1)).toEqual({ error: "INVALID_AMOUNT" });
    expect(calcSwapQuote(5, 100, 1, { balanceSrc: 4 })).toEqual({
      error: "INSUFFICIENT_BALANCE",
    });
    expect(
      calcSwapQuote(1, 100, 1, { srcSymbol: "WETH", dstSymbol: "WETH" }),
    ).toEqual({ error: "SAME_ASSET" });
    expect(calcSwapQuote(1, 100, 1, { destEligible: false })).toEqual({
      error: "INELIGIBLE_DEST",
    });
  });
});

describe("getSwapDestinations", () => {
  const catalog = () => [
    asset("WETH"),
    asset("USDC"),
    asset("DAI"),
    asset("WBTC"),
    asset("USDT"),
    asset("AAVE"),
  ];

  it("excludes the source symbol on both sides", () => {
    expect(
      getSwapDestinations(catalog(), "RESERVE", "WETH").map((a) => a.symbol),
    ).not.toContain("WETH");
    expect(
      getSwapDestinations(catalog(), "BORROW", "USDC").map((a) => a.symbol),
    ).not.toContain("USDC");
  });

  it("pins USDC first, then stablecoins, then alphabetical", () => {
    const symbols = getSwapDestinations(catalog(), "RESERVE", "WETH").map(
      (a) => a.symbol,
    );
    expect(symbols).toEqual(["USDC", "DAI", "USDT", "AAVE", "WBTC"]);
  });

  it("filters ineligible assets per side", () => {
    const mixed = [
      asset("USDC"),
      asset("FROZEN", { isFrozen: true }),
      asset("NOBORROW", { borrowingEnabled: false }),
      asset("NOCOLLAT", { usageAsCollateralEnabled: false }),
    ];
    expect(
      getSwapDestinations(mixed, "RESERVE", "XXX").map((a) => a.symbol),
    ).toEqual(["USDC", "NOBORROW"]);
    expect(
      getSwapDestinations(mixed, "BORROW", "XXX").map((a) => a.symbol),
    ).toEqual(["USDC", "NOCOLLAT"]);
  });
});
