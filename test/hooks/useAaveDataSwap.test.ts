import { expect } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useAaveData,
  AaveHealthFactorData,
  AssetDetails,
} from "../../hooks/useAaveData";
import { calcSwapQuote } from "../../utils/swapQuote";
import { diffSimOps } from "../../utils/shareCard";
import { getAaveData } from "../../pages/api/aave";

jest.mock("@lingui/core/macro", () => ({
  t: (first: unknown, ...rest: unknown[]) => {
    const interpolate = (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce(
        (acc, part, index) => acc + part + String(values[index] ?? ""),
        "",
      );
    if (Array.isArray(first))
      return interpolate(first as unknown as TemplateStringsArray, ...rest);
    return interpolate;
  },
}));

jest.mock("../../pages/api/aave", () => ({
  getAaveData: jest.fn(),
}));
jest.mock("../../pages/api/resolver", () => ({
  getResolvedAddress: jest.fn(async (address: string) => address),
}));

const mockGetAaveData = getAaveData as jest.Mock;

const mkAsset = (symbol: string, priceInUSD: number): AssetDetails =>
  ({
    symbol,
    name: symbol,
    priceInUSD,
    priceInMarketReferenceCurrency: priceInUSD / 10000,
    baseLTVasCollateral: 8000,
    isActive: true,
    isFrozen: false,
    isPaused: false,
    reserveLiquidationThreshold: 8500,
    reserveFactor: 0,
    usageAsCollateralEnabled: true,
    initialPriceInUSD: priceInUSD,
    borrowingEnabled: true,
  }) as AssetDetails;

const seed = (): AaveHealthFactorData =>
  ({
    healthFactor: 2,
    totalBorrowsUSD: 500,
    availableBorrowsUSD: 1000,
    totalCollateralMarketReferenceCurrency: 3.1,
    totalBorrowsMarketReferenceCurrency: 0.05,
    currentLiquidationThreshold: 0.85,
    currentLoanToValue: 0.8,
    userReservesData: [
      {
        asset: mkAsset("WETH", 3000),
        underlyingBalance: 10,
        underlyingBalanceUSD: 30000,
        underlyingBalanceMarketReferenceCurrency: 3,
        usageAsCollateralEnabledOnUser: true,
      },
      {
        asset: mkAsset("USDC", 1),
        underlyingBalance: 1000,
        underlyingBalanceUSD: 1000,
        underlyingBalanceMarketReferenceCurrency: 0.1,
        usageAsCollateralEnabledOnUser: true,
      },
    ],
    userBorrowsData: [
      {
        asset: mkAsset("USDC", 1),
        totalBorrows: 500,
        totalBorrowsUSD: 500,
        totalBorrowsMarketReferenceCurrency: 0.05,
        stableBorrowAPY: 0,
      },
      {
        asset: mkAsset("DAI", 1),
        totalBorrows: 100,
        totalBorrowsUSD: 100,
        totalBorrowsMarketReferenceCurrency: 0.01,
        stableBorrowAPY: 0,
      },
    ],
  }) as AaveHealthFactorData;

let addrCounter = 0;

const setup = () => {
  addrCounter += 1;
  const address = `0xswaptest${String(addrCounter).padStart(34, "0")}`;
  mockGetAaveData.mockReset();
  mockGetAaveData.mockImplementation(async () =>
    JSON.parse(
      JSON.stringify({
        address,
        marketReferenceCurrencyPriceInUSD: 10000,
        fetchedData: seed(),
        workingData: seed(),
        availableAssets: [
          mkAsset("WETH", 3000),
          mkAsset("USDC", 1),
          mkAsset("DAI", 1),
          mkAsset("WBTC", 60000),
        ],
        lastFetched: Date.now(),
      }),
    ),
  );
  return renderHook(() => useAaveData(address));
};

const workingOf = (r: any) =>
  r.current.addressData?.[r.current.currentMarket].workingData;

describe("useAaveData swap mutators", () => {
  test("partial supply swap moves quoted quantity", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    const srcBal: number = workingOf(result).userReservesData.find(
      (i: any) => i.asset.symbol === "WETH",
    ).underlyingBalance;
    const before =
      result.current.addressData?.[result.current.currentMarket].workingData
        ?.healthFactor;
    const quote = calcSwapQuote(1, 3000, 1);
    expect("quote" in quote).toBe(true);
    const qtyDest = (quote as any).quote.qtyDest;
    act(() => {
      result.current.swapReserveAsset("WETH", "USDC", 1);
    });
    const w = workingOf(result);
    expect(
      w.userReservesData.find((i: any) => i.asset.symbol === "WETH")
        .underlyingBalance,
    ).toBeCloseTo(srcBal - 1, 6);
    expect(
      w.userReservesData.find((i: any) => i.asset.symbol === "USDC")
        .underlyingBalance,
    ).toBeCloseTo(1000 + qtyDest, 6);
    expect(w.healthFactor).not.toEqual(before);
    expect(void result.current.swapReserveAsset).toBeUndefined();
  });

  test("total supply swap retains zero-balance source row", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    act(() => {
      result.current.swapReserveAsset("WETH", "USDC", 10);
    });
    const w = workingOf(result);
    const src = w.userReservesData.find((i: any) => i.asset.symbol === "WETH");
    expect(src).toBeDefined();
    expect(src.underlyingBalance).toEqual(0);
  });

  test("swap into absent destination creates user-added row", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    act(() => {
      result.current.swapReserveAsset("WETH", "WBTC", 1);
    });
    const w = workingOf(result);
    const dst = w.userReservesData.find((i: any) => i.asset.symbol === "WBTC");
    expect(dst).toBeDefined();
    expect(dst.asset.isNewlyAddedBySimUser).toBe(true);
    expect(dst.usageAsCollateralEnabledOnUser).toBe(true);
    expect(dst.underlyingBalance).toBeGreaterThan(0);
  });

  test("partial borrow swap moves quoted debt quantity", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    const quote = calcSwapQuote(50, 1, 1);
    const qtyDest = (quote as any).quote.qtyDest;
    act(() => {
      result.current.swapBorrowedAsset("USDC", "DAI", 50);
    });
    const w = workingOf(result);
    expect(
      w.userBorrowsData.find((i: any) => i.asset.symbol === "USDC")
        .totalBorrows,
    ).toBeCloseTo(450, 6);
    expect(
      w.userBorrowsData.find((i: any) => i.asset.symbol === "DAI").totalBorrows,
    ).toBeCloseTo(100 + qtyDest, 6);
  });

  test("borrow swap into absent destination creates user-added row", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    act(() => {
      result.current.swapBorrowedAsset("USDC", "WBTC", 50);
    });
    const w = workingOf(result);
    const dst = w.userBorrowsData.find((i: any) => i.asset.symbol === "WBTC");
    expect(dst).toBeDefined();
    expect(dst.asset.isNewlyAddedBySimUser).toBe(true);
    expect(dst.totalBorrows).toBeGreaterThan(0);
    expect(
      w.userBorrowsData.find((i: any) => i.asset.symbol === "USDC")
        .totalBorrows,
    ).toBeCloseTo(450, 6);
  });

  test("invalid input is a defensive no-op", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    const before = JSON.stringify(workingOf(result));
    act(() => {
      result.current.swapReserveAsset("WETH", "WETH", 1);
      result.current.swapReserveAsset("WETH", "USDC", 999999);
      result.current.swapReserveAsset("WETH", "USDC", -5);
      result.current.swapReserveAsset("NOPE", "USDC", 1);
      result.current.swapBorrowedAsset("USDC", "DAI", 0);
    });
    expect(JSON.stringify(workingOf(result))).toEqual(before);
  });

  test("applied quantities equal calcSwapQuote preview + replay equality", async () => {
    const { result } = setup();
    await waitFor(() => expect(workingOf(result)).not.toBeUndefined());
    const data = result.current.addressData?.[result.current.currentMarket];
    const fetched = JSON.parse(JSON.stringify(data.fetchedData));
    const preview = calcSwapQuote(2, 3000, 1);
    const qtyDest = (preview as any).quote.qtyDest;
    act(() => {
      result.current.swapReserveAsset("WETH", "USDC", 2);
    });
    const w = workingOf(result);
    expect(
      w.userReservesData.find((i: any) => i.asset.symbol === "USDC")
        .underlyingBalance,
    ).toBeCloseTo(1000 + qtyDest, 6);
    // Share-diff replay reproduces identical balances
    const ops = diffSimOps(fetched, JSON.parse(JSON.stringify(w)));
    expect(ops.length).toBeGreaterThan(0);
    const { result: r2 } = setup();
    await waitFor(() =>
      expect(
        r2.current.addressData?.[r2.current.currentMarket].workingData,
      ).not.toBeUndefined(),
    );
    act(() => {
      r2.current.applySimSnapshot(ops);
    });
    const w2 = r2.current.addressData?.[r2.current.currentMarket]
      .workingData as any;
    expect(
      w2.userReservesData.find((i: any) => i.asset.symbol === "USDC")
        .underlyingBalance,
    ).toBeCloseTo(
      w.userReservesData.find((i: any) => i.asset.symbol === "USDC")
        .underlyingBalance,
      6,
    );
  });
});
