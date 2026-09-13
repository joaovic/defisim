import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

import SwapAssetDialog from "../../components/assets/SwapAssetDialog";

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

const swapReserveAsset = jest.fn();
const swapBorrowedAsset = jest.fn();

const mkAsset = (symbol: string, priceInUSD: number, extra = {}) => ({
  symbol,
  name: symbol,
  priceInUSD,
  priceInMarketReferenceCurrency: priceInUSD,
  baseLTVasCollateral: 8000,
  reserveLiquidationThreshold: 8500,
  usageAsCollateralEnabled: true,
  borrowingEnabled: true,
  isActive: true,
  isFrozen: false,
  isPaused: false,
  initialPriceInUSD: priceInUSD,
  ...extra,
});

const mockState = () => ({
  currentMarket: "ETHEREUM_V3",
  addressData: {
    ETHEREUM_V3: {
      availableAssets: [
        mkAsset("WBTC", 60000),
        mkAsset("USDC", 1),
        mkAsset("DAI", 1),
      ],
      marketReferenceCurrencyPriceInUSD: 1,
      workingData: {
        healthFactor: 2,
        totalBorrowsUSD: 1000,
        availableBorrowsUSD: 500,
        totalCollateralMarketReferenceCurrency: 5000,
        totalBorrowsMarketReferenceCurrency: 1000,
        currentLiquidationThreshold: 0.85,
        currentLoanToValue: 0.8,
        userReservesData: [
          {
            asset: mkAsset("WBTC", 60000),
            underlyingBalance: 1,
            underlyingBalanceUSD: 60000,
            underlyingBalanceMarketReferenceCurrency: 60000,
            usageAsCollateralEnabledOnUser: true,
          },
        ],
        userBorrowsData: [
          {
            asset: mkAsset("WBTC", 60000),
            totalBorrows: 1,
            totalBorrowsUSD: 60000,
            totalBorrowsMarketReferenceCurrency: 60000,
            stableBorrowAPY: 0,
          },
        ],
        userEmodeCategoryId: 0,
      },
    },
  },
  swapReserveAsset,
  swapBorrowedAsset,
});

jest.mock("../../pages/api/aave", () => ({ getAaveData: jest.fn() }));
jest.mock("../../pages/api/resolver", () => ({
  getResolvedAddress: jest.fn(async (a: string) => a),
}));
jest.mock("../../hooks/useAaveData", () => {
  const actual = jest.requireActual("../../hooks/useAaveData");
  return { ...actual, useAaveData: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAaveData } = require("../../hooks/useAaveData") as {
  useAaveData: jest.Mock;
};

(global as any).ResizeObserver = class {
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

const renderDialog = (props = {}) => {
  i18n.load("en", {});
  i18n.activate("en");
  const onClose = jest.fn();
  const utils = render(
    <I18nProvider i18n={i18n}>
      <MantineProvider>
        <SwapAssetDialog
          opened
          onClose={onClose}
          srcSymbol="WBTC"
          assetType="RESERVE"
          {...props}
        />
      </MantineProvider>
    </I18nProvider>,
  );
  return { onClose, ...utils };
};

describe("SwapAssetDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAaveData.mockReturnValue(mockState());
    // Mantine portals: focus may be async; keep timers default.
  });

  it("renders source context with empty amount", () => {
    renderDialog();
    expect(screen.getAllByText(/WBTC/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Swap amount")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm swap" })).toBeDisabled();
  });

  it("MAX populates the full balance", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: /max/i }));
    expect(screen.getByLabelText("Swap amount")).toHaveValue("1");
  });

  it.each([
    ["Use 25 percent of balance", "0.25"],
    ["Use 50 percent of balance", "0.5"],
    ["Use 75 percent of balance", "0.75"],
  ])("preset %s fills the proportional amount", async (label, expected) => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: label }));
    expect(screen.getByLabelText("Swap amount")).toHaveValue(expected);
  });

  it("marks the clicked preset as selected", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    );
    expect(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    ).toHaveAttribute("data-variant", "filled");
    expect(
      screen.getByRole("button", { name: "Use 25 percent of balance" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Use 25 percent of balance" }),
    ).toHaveAttribute("data-variant", "subtle");
    expect(screen.getByRole("button", { name: "Use max amount" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks MAX as selected when clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Use max amount" }));
    expect(screen.getByRole("button", { name: "Use max amount" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("manual typing clears the preset selection", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    );
    expect(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByLabelText("Swap amount"), "1");
    expect(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("preset amount produces a valid quote for confirm", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(
      screen.getByRole("button", { name: "Use 50 percent of balance" }),
    );
    expect(await screen.findByText(/Estimate:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(swapReserveAsset).toHaveBeenCalledWith("WBTC", "USDC", 0.5);
    expect(onClose).toHaveBeenCalled();
  });

  it("changing destination refreshes the quote", async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText("Swap amount");
    await user.type(input, "0.5");
    expect(await screen.findByText(/Estimate:/)).toBeInTheDocument();
    const before = screen.getByText(/Estimate:/).textContent;
    await user.click(screen.getByRole("button", { name: "Select DAI" }));
    await waitFor(() => {
      expect(screen.getByText(/Estimate:/).textContent).toContain("DAI");
    });
    expect(screen.getByText(/Estimate:/).textContent).not.toBeNull();
    expect(before).toBeTruthy();
  });

  it("invalid amount disables confirm with message", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Swap amount"), "99");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm swap" })).toBeDisabled();
  });

  it("same-asset selection is rejected", async () => {
    useAaveData.mockReturnValue({
      ...mockState(),
      addressData: {
        ETHEREUM_V3: {
          ...mockState().addressData.ETHEREUM_V3,
          availableAssets: [mkAsset("WBTC", 60000)],
        },
      },
    });
    renderDialog();
    await userEvent.setup().type(screen.getByLabelText("Swap amount"), "0.1");
    // No destinations -> confirm disabled
    expect(screen.getByRole("button", { name: "Confirm swap" })).toBeDisabled();
  });

  it("confirm calls mutator and closes, shows HF preview, focuses input", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const input = screen.getByLabelText("Swap amount");
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "0.5");
    expect(await screen.findByText(/Health Factor:/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(swapReserveAsset).toHaveBeenCalledWith("WBTC", "USDC", 0.5);
    expect(onClose).toHaveBeenCalled();
  });

  it("borrow side confirm calls borrow mutator", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ assetType: "BORROW" });
    await user.type(screen.getByLabelText("Swap amount"), "0.2");
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(swapBorrowedAsset).toHaveBeenCalledWith("WBTC", "USDC", 0.2);
    expect(onClose).toHaveBeenCalled();
  });

  it("marks the default destination as selected", () => {
    renderDialog();
    expect(
      screen.getByRole("button", { name: "Select USDC" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Select DAI" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Selected")).toBeInTheDocument();
  });

  it("moves the selection highlight when another destination is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Select DAI" }));
    expect(
      screen.getByRole("button", { name: "Select DAI" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Select USDC" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("search shows the selected destination as placeholder", () => {
    renderDialog();
    expect(
      screen.getByLabelText("Search destination assets"),
    ).toHaveAttribute("placeholder", "USDC");
  });

  it("search placeholder follows the selected destination", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Select DAI" }));
    expect(screen.getByLabelText("Search destination assets")).toHaveAttribute(
      "placeholder",
      "DAI",
    );
  });

  it("typing in search filters the destination list", async () => {
    const user = userEvent.setup();
    renderDialog();
    // Let the open-time focus timer elapse so typing lands in search.
    await waitFor(() =>
      expect(screen.getByLabelText("Swap amount")).toHaveFocus(),
    );
    await user.type(screen.getByLabelText("Search destination assets"), "dai");
    expect(
      screen.getByRole("button", { name: "Select DAI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select USDC" }),
    ).not.toBeInTheDocument();
  });

  it("shows the remaining source balance after swap", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Swap amount"), "0.5");
    expect(await screen.findByText(/WBTC balance:/)).toBeInTheDocument();
    expect(screen.getByText(/WBTC balance:/).textContent).toContain(
      "1.00 → 0.5",
    );
  });

  it("formats the estimate compactly instead of full float precision", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Swap amount"), "0.5");
    const estimate = await screen.findByText(/Estimate:/);
    expect(estimate.textContent).toContain("29,970.00 USDC (≈ $30,000.00)");
  });

  it("shows the remaining debt on the borrow side", async () => {
    const user = userEvent.setup();
    renderDialog({ assetType: "BORROW" });
    await user.type(screen.getByLabelText("Swap amount"), "0.2");
    expect(await screen.findByText(/WBTC debt:/)).toBeInTheDocument();
    expect(screen.getByText(/WBTC debt:/).textContent).toContain("1.00 → 0.8");
  });

  it("hides the remainder without a valid amount", () => {
    renderDialog();
    expect(screen.queryByText(/WBTC (balance|debt):/)).not.toBeInTheDocument();
  });

  it("escape closes the dialog", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
