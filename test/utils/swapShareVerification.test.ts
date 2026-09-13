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

import { diffSimOps, SimOp } from "../../utils/shareCard";
import type { AaveHealthFactorData } from "../../hooks/useAaveData";

const mkReserve = (
  symbol: string,
  underlyingBalance: number,
  priceInUSD = 1,
  usageAsCollateralEnabledOnUser = true,
): any => ({
  asset: { symbol, priceInUSD },
  underlyingBalance,
  usageAsCollateralEnabledOnUser,
});

const mkBorrow = (
  symbol: string,
  totalBorrows: number,
  priceInUSD = 1,
): any => ({
  asset: { symbol, priceInUSD },
  totalBorrows,
});

const mkData = (reserves: any[], borrows: any[]): AaveHealthFactorData =>
  ({
    userReservesData: reserves,
    userBorrowsData: borrows,
  }) as unknown as AaveHealthFactorData;

const ALLOWED_OPS = new Set([
  "addReserve",
  "addBorrow",
  "reserveQty",
  "borrowQty",
  "price",
  "collateral",
  "removeAsset",
]);

describe("task05 swap share verification", () => {
  test("swapped position diffs to existing ops only", () => {
    const fetched = mkData(
      [mkReserve("WETH", 10, 3000), mkReserve("USDC", 1000, 1)],
      [mkBorrow("USDC", 500, 1)],
    );
    // Full supply swap WETH -> WBTC: source retained at zero, dest added.
    const working = mkData(
      [
        mkReserve("WETH", 0, 3000),
        mkReserve("USDC", 1000, 1),
        mkReserve("WBTC", 0.5, 60000),
      ],
      [mkBorrow("USDC", 500, 1)],
    );
    const ops: SimOp[] = diffSimOps(fetched, working);
    expect(ops.length).toBeGreaterThan(0);
    ops.forEach((op) => expect(ALLOWED_OPS.has(op.op)).toBe(true));
    // New-format ops must not appear: only pre-existing op types.
    expect(
      ops.every((op) =>
        [
          "addReserve",
          "addBorrow",
          "reserveQty",
          "borrowQty",
          "price",
          "collateral",
          "removeAsset",
        ].includes(op.op),
      ),
    ).toBe(true);
  });

  test("no removeAsset op for fully swapped source retained at zero", () => {
    const fetched = mkData([mkReserve("WETH", 10, 3000)], []);
    const working = mkData(
      [mkReserve("WETH", 0, 3000), mkReserve("USDC", 30000, 1)],
      [],
    );
    const ops = diffSimOps(fetched, working);
    expect(
      ops.filter((op) => op.op === "removeAsset" && (op as any).s === "WETH"),
    ).toHaveLength(0);
    // Source zero-balance is captured as a quantity op instead.
    expect(
      ops.some((op) => op.op === "reserveQty" && (op as any).s === "WETH"),
    ).toBe(true);
  });

  test("replaying swap ops reproduces swapped balances exactly", () => {
    const fetched = mkData(
      [mkReserve("WETH", 10, 3000), mkReserve("USDC", 1000, 1)],
      [mkBorrow("USDC", 500, 1), mkBorrow("DAI", 100, 1)],
    );
    const working = mkData(
      [
        mkReserve("WETH", 8, 3000),
        mkReserve("USDC", 7000, 1),
        mkReserve("WBTC", 0.05, 60000),
      ],
      [mkBorrow("USDC", 450, 1), mkBorrow("DAI", 150, 1)],
    );
    const ops = diffSimOps(fetched, working);
    // Naive replay of quantity/add ops onto a clone of fetched.
    const replayed = JSON.parse(JSON.stringify(fetched)) as any;
    const byReserve = new Map<string, any>(
      replayed.userReservesData.map((r: any) => [r.asset.symbol, r]),
    );
    const byBorrow = new Map<string, any>(
      replayed.userBorrowsData.map((b: any) => [b.asset.symbol, b]),
    );
    ops.forEach((op: SimOp) => {
      if (op.op === "addReserve")
        byReserve.set(op.s, mkReserve(op.s, 0, 60000));
      else if (op.op === "addBorrow") byBorrow.set(op.s, mkBorrow(op.s, 0));
      else if (op.op === "reserveQty")
        byReserve.get(op.s).underlyingBalance = op.n;
      else if (op.op === "borrowQty") byBorrow.get(op.s).totalBorrows = op.n;
    });
    replayed.userReservesData = [...byReserve.values()];
    replayed.userBorrowsData = [...byBorrow.values()];
    const want = new Map(
      (working.userReservesData as any[]).map((r) => [
        r.asset.symbol,
        r.underlyingBalance,
      ]),
    );
    (replayed.userReservesData as any[]).forEach((r) =>
      expect(r.underlyingBalance).toBeCloseTo(want.get(r.asset.symbol)!, 6),
    );
    const wantB = new Map(
      (working.userBorrowsData as any[]).map((b) => [
        b.asset.symbol,
        b.totalBorrows,
      ]),
    );
    (replayed.userBorrowsData as any[]).forEach((b) =>
      expect(b.totalBorrows).toBeCloseTo(wantB.get(b.asset.symbol)!, 6),
    );
  });
});
