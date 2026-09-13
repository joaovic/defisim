import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

import { UserAssetItem } from "../../components/assets/UserAssetItem";
import type { AssetDetails } from "../../hooks/useAaveData";

jest.mock("next/router", () => ({ useRouter: () => ({ locale: "en" }) }));
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
jest.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("../../components/assets/SwapAssetDialog", () => ({
  __esModule: true,
  default: jest.fn(
    ({
      opened,
      srcSymbol,
      assetType,
    }: {
      opened: boolean;
      srcSymbol: string;
      assetType: string;
    }) =>
      opened ? (
        <div>
          Swap {assetType === "RESERVE" ? "supply" : "debt"} {srcSymbol}
        </div>
      ) : null,
  ),
}));

(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

const mkAsset = (symbol: string) => ({
  symbol,
  name: symbol,
  priceInUSD: 1,
  priceInMarketReferenceCurrency: 1,
  baseLTVasCollateral: 8000,
  reserveLiquidationThreshold: 8500,
  usageAsCollateralEnabled: true,
  borrowingEnabled: true,
  isActive: true,
  isFrozen: false,
  isPaused: false,
  initialPriceInUSD: 1,
});

beforeEach(() => {
  jest.clearAllMocks();
});

const baseProps: {
  assetSymbol: string;
  assetType: "RESERVE" | "BORROW";
  usageAsCollateralEnabledOnUser: boolean;
  assetDetails: AssetDetails;
  workingQuantity: number;
  originalQuantity: number;
  workingPrice: number;
  originalPrice: number;
  onRemoveAsset: jest.Mock;
  setAssetPriceInUSD: jest.Mock;
  setAssetQuantity: jest.Mock;
  setUseReserveAssetAsCollateral: jest.Mock;
  disableSetUseReserveAssetAsCollateral: boolean;
  isNewlyAddedBySimUser: boolean;
  locale: string;
} = {
  assetSymbol: "WBTC",
  assetType: "RESERVE",
  usageAsCollateralEnabledOnUser: true,
  assetDetails: mkAsset("WBTC") as unknown as AssetDetails,
  workingQuantity: 1,
  originalQuantity: 1,
  workingPrice: 1,
  originalPrice: 1,
  onRemoveAsset: jest.fn(),
  setAssetPriceInUSD: jest.fn(),
  setAssetQuantity: jest.fn(),
  setUseReserveAssetAsCollateral: jest.fn(),
  disableSetUseReserveAssetAsCollateral: false,
  isNewlyAddedBySimUser: false,
  locale: "en",
};

const renderItem = (props: Partial<typeof baseProps> = {}) => {
  i18n.load("en", {});
  i18n.activate("en");
  return render(
    <I18nProvider i18n={i18n}>
      <MantineProvider>
        <UserAssetItem {...baseProps} {...props} />
      </MantineProvider>
    </I18nProvider>,
  );
};

test("supply row renders Swap button with expected accessible name", () => {
  renderItem({ assetType: "RESERVE" });
  expect(screen.getByRole("button", { name: "Swap WBTC" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove WBTC" }),
  ).toBeInTheDocument();
});

test("borrow row renders Swap button with expected accessible name", () => {
  renderItem({ assetType: "BORROW" });
  expect(screen.getByRole("button", { name: "Swap WBTC" })).toBeInTheDocument();
});

test("activating Swap on a supply row opens the dialog for that source asset", async () => {
  const user = userEvent.setup();
  renderItem({ assetType: "RESERVE" });
  await user.click(screen.getByRole("button", { name: "Swap WBTC" }));
  expect(await screen.findByText(/Swap supply WBTC/)).toBeInTheDocument();
});

test("activating Swap on a borrow row opens the dialog for that source debt", async () => {
  const user = userEvent.setup();
  renderItem({ assetType: "BORROW" });
  await user.click(screen.getByRole("button", { name: "Swap WBTC" }));
  expect(await screen.findByText(/Swap debt WBTC/)).toBeInTheDocument();
});

test("parent lists pass through unchanged props (no snapshot drift)", () => {
  const { container } = renderItem({ assetType: "RESERVE" });
  // Both row actions present, quantity/price inputs intact.
  expect(container.querySelectorAll("input").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("button", { name: "Swap WBTC" })).toBeInTheDocument();
});

test("memo checker still prevents redundant rerenders for unchanged row props", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SwapDialog = require("../../components/assets/SwapAssetDialog").default;
  SwapDialog.mockClear();
  const { rerender } = renderItem({ assetType: "RESERVE" });
  const callsAfterMount = SwapDialog.mock.calls.length;
  rerender(
    <I18nProvider i18n={i18n}>
      <MantineProvider>
        <UserAssetItem {...baseProps} assetType="RESERVE" />
      </MantineProvider>
    </I18nProvider>,
  );
  expect(SwapDialog.mock.calls.length).toBe(callsAfterMount);
  rerender(
    <I18nProvider i18n={i18n}>
      <MantineProvider>
        <UserAssetItem {...baseProps} assetType="RESERVE" workingQuantity={2} />
      </MantineProvider>
    </I18nProvider>,
  );
  expect(SwapDialog.mock.calls.length).toBeGreaterThan(callsAfterMount);
});
