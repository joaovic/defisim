import * as React from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import {
  Button,
  Group,
  Modal,
  TextInput,
  Text,
  NumberInput,
  List,
  UnstyledButton,
} from "@mantine/core";
import {
  useAaveData,
  updateDerivedHealthFactorData,
} from "../../hooks/useAaveData";
import { calcSwapQuote, getSwapDestinations } from "../../utils/swapQuote";
import type { SwapSide } from "../../utils/swapQuote";
import TokenIcon from "../TokenIcon";
import { BsCheck2 } from "react-icons/bs";
import { formatTokenAmount } from "../../utils/formatTokenAmount";
import classes from "./SwapAssetDialog.module.css";

export type SwapAssetDialogProps = {
  opened: boolean;
  onClose: () => void;
  srcSymbol: string;
  assetType: "RESERVE" | "BORROW";
};

const ERROR_MESSAGE_KEYS: Record<string, string> = {
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  INSUFFICIENT_BALANCE: "Amount exceeds available balance.",
  SAME_ASSET: "Choose a different destination asset.",
  INELIGIBLE_DEST: "Destination is not eligible for this position.",
  MISSING_PRICE: "Price unavailable for the selected asset.",
};

export default function SwapAssetDialog({
  opened,
  onClose,
  srcSymbol,
  assetType,
}: SwapAssetDialogProps) {
  const [amountText, setAmountText] = React.useState("");
  const [searchText, setSearchText] = React.useState("");
  const [dstSymbol, setDstSymbol] = React.useState<string | null>(null);
  // Last preset used (0.25 | 0.5 | 0.75 | 1 for MAX); null when typed manually.
  const [activePreset, setActivePreset] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { i18n } = useLingui();
  const { addressData, currentMarket, swapReserveAsset, swapBorrowedAsset } =
    useAaveData("");

  const marketData = addressData?.[currentMarket];
  const workingData = marketData?.workingData;
  const side: SwapSide = assetType === "RESERVE" ? "RESERVE" : "BORROW";

  const srcRow =
    assetType === "RESERVE"
      ? workingData?.userReservesData.find((r) => r.asset.symbol === srcSymbol)
      : workingData?.userBorrowsData.find((b) => b.asset.symbol === srcSymbol);
  const balance =
    assetType === "RESERVE"
      ? ((srcRow as { underlyingBalance?: number } | undefined)
          ?.underlyingBalance ?? 0)
      : ((srcRow as { totalBorrows?: number } | undefined)?.totalBorrows ?? 0);
  const priceSrc = srcRow?.asset.priceInUSD ?? 0;

  const destinations = React.useMemo(
    () =>
      getSwapDestinations(marketData?.availableAssets ?? [], side, srcSymbol),
    [marketData?.availableAssets, side, srcSymbol],
  );

  // Default to USDC when available.
  React.useEffect(() => {
    if (!opened) return;
    setAmountText("");
    setActivePreset(null);
    setSearchText("");
    setDstSymbol((prev) => {
      if (prev && destinations.some((d) => d.symbol === prev)) return prev;
      const usdc = destinations.find((d) => d.symbol === "USDC");
      return usdc?.symbol ?? destinations[0]?.symbol ?? null;
    });
  }, [opened, destinations]);

  React.useEffect(() => {
    if (opened) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [opened]);

  const amount = Number(amountText);
  const dstDetails = destinations.find((d) => d.symbol === dstSymbol);
  const priceDst = dstDetails?.priceInUSD ?? 0;

  const filtered = destinations.filter((d) => {
    if (!searchText.length) return true;
    const q = searchText.toUpperCase();
    return (
      d.symbol.toUpperCase().includes(q) || d.name.toUpperCase().includes(q)
    );
  });

  const result =
    dstSymbol == null
      ? { error: "INELIGIBLE_DEST" as const }
      : calcSwapQuote(amount, priceSrc, priceDst, {
          balanceSrc: balance,
          srcSymbol,
          dstSymbol,
        });
  const quote = result && "quote" in result ? result.quote : null;
  const errorKey =
    result && "error" in result ? ERROR_MESSAGE_KEYS[result.error] : null;

  const previewHf = React.useMemo(() => {
    if (!workingData || !quote || dstSymbol == null) return null;
    try {
      const clone = JSON.parse(JSON.stringify(workingData));
      const mktPrice = marketData?.marketReferenceCurrencyPriceInUSD ?? 1;
      if (assetType === "RESERVE") {
        const src = clone.userReservesData.find(
          (r: { asset: { symbol: string } }) => r.asset.symbol === srcSymbol,
        );
        let dst = clone.userReservesData.find(
          (r: { asset: { symbol: string } }) => r.asset.symbol === dstSymbol,
        );
        if (!src) return null;
        if (!dst) {
          clone.userReservesData.push({
            asset: JSON.parse(
              JSON.stringify(destinations.find((d) => d.symbol === dstSymbol)),
            ),
            underlyingBalance: 0,
            underlyingBalanceUSD: 0,
            underlyingBalanceMarketReferenceCurrency: 0,
            usageAsCollateralEnabledOnUser:
              destinations.find((d) => d.symbol === dstSymbol)
                ?.usageAsCollateralEnabled ?? false,
          });
          dst = clone.userReservesData[clone.userReservesData.length - 1];
        }
        src.underlyingBalance -= amount;
        dst.underlyingBalance += quote.qtyDest;
      } else {
        const src = clone.userBorrowsData.find(
          (b: { asset: { symbol: string } }) => b.asset.symbol === srcSymbol,
        );
        let dst = clone.userBorrowsData.find(
          (b: { asset: { symbol: string } }) => b.asset.symbol === dstSymbol,
        );
        if (!src) return null;
        if (!dst) {
          clone.userBorrowsData.push({
            asset: JSON.parse(
              JSON.stringify(destinations.find((d) => d.symbol === dstSymbol)),
            ),
            totalBorrows: 0,
            totalBorrowsUSD: 0,
            totalBorrowsMarketReferenceCurrency: 0,
            stableBorrowAPY: 0,
          });
          dst = clone.userBorrowsData[clone.userBorrowsData.length - 1];
        }
        src.totalBorrows -= amount;
        dst.totalBorrows += quote.qtyDest;
      }
      const updated = updateDerivedHealthFactorData(clone, mktPrice);
      return updated.healthFactor as number;
    } catch {
      return null;
    }
  }, [
    workingData,
    quote?.qtyDest,
    marketData?.marketReferenceCurrencyPriceInUSD,
    destinations,
    assetType,
    srcSymbol,
    dstSymbol,
    amount,
  ]);

  const handleClose = () => {
    setAmountText("");
    setActivePreset(null);
    setSearchText("");
    onClose();
  };

  const handleConfirm = () => {
    if (!quote || !dstSymbol) return;
    if (assetType === "RESERVE") swapReserveAsset(srcSymbol, dstSymbol, amount);
    else swapBorrowedAsset(srcSymbol, dstSymbol, amount);
    handleClose();
  };

  const handleMax = () => {
    setAmountText(String(balance));
    setActivePreset(1);
  };

  const handlePercent = (pct: number) => {
    // Normalize float noise (e.g. 0.1 * 0.75) while keeping full precision.
    setAmountText(String(Number((balance * pct).toPrecision(12))));
    setActivePreset(pct);
  };

  const handleAmountChange = (v: string | number | undefined) => {
    // Manual edits always clear the preset highlight.
    setAmountText(String(v ?? ""));
    setActivePreset(null);
  };

  const fmtHf = (v: number | undefined) =>
    v === undefined ? "—" : !Number.isFinite(v) ? "∞" : v.toFixed(2);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t`Swap ${assetType === "RESERVE" ? "supply" : "debt"} ${srcSymbol}`}
    >
      <Text size="sm" mb={8}>
        <Trans>
          Available: {balance} {srcSymbol}
        </Trans>
      </Text>
      <Group align="flex-end" wrap="nowrap" mb={8}>
        <NumberInput
          ref={inputRef}
          label={t`Amount`}
          aria-label={t`Swap amount`}
          value={amountText}
          onChange={handleAmountChange}
          min={0}
          style={{ flex: "1 1 auto", minWidth: 0 }}
        />
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {(
            [
              { pct: 0.25, label: t`Use 25 percent of balance`, text: "25%" },
              { pct: 0.5, label: t`Use 50 percent of balance`, text: "50%" },
              { pct: 0.75, label: t`Use 75 percent of balance`, text: "75%" },
              { pct: 1, label: t`Use max amount`, text: t`MAX` },
            ] as const
          ).map(({ pct, label, text }) => (
            <Button
              key={pct}
              variant={activePreset === pct ? "filled" : "subtle"}
              size="compact-sm"
              onClick={() => (pct === 1 ? handleMax() : handlePercent(pct))}
              aria-label={label}
              aria-pressed={activePreset === pct}
            >
              {text}
            </Button>
          ))}
        </Group>
      </Group>
      {errorKey && amountText.length > 0 && (
        <Text c="red" size="sm" role="alert">
          {errorKey}
        </Text>
      )}
      <TextInput
        label={t`Search destination`}
        aria-label={t`Search destination assets`}
        placeholder={dstSymbol ?? undefined}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        mb={8}
      />
      <List listStyleType="none" aria-label={t`Destination assets`}>
        {filtered.map((d) => {
          const isSelected = d.symbol === dstSymbol;
          return (
            <List.Item key={d.symbol} m={5}>
              <UnstyledButton
                onClick={() => setDstSymbol(d.symbol)}
                aria-label={t`Select ${d.symbol}`}
                aria-pressed={isSelected}
                className={`${classes.row}${isSelected ? ` ${classes.rowSelected}` : ""}`}
              >
                <Group gap="sm" wrap="nowrap">
                  <TokenIcon symbol={d.symbol} size="30px" alt={`${d.symbol}`} />
                  <Text fw={isSelected ? 700 : 400}>{d.symbol}</Text>
                  {isSelected && (
                    <BsCheck2
                      className={classes.rowCheck}
                      aria-label={t`Selected`}
                      size={18}
                    />
                  )}
                </Group>
              </UnstyledButton>
            </List.Item>
          );
        })}
      </List>
      {quote && dstDetails ? (
        <div>
          <Text fw={600} mt={8}>
            <Trans>
              Estimate: {formatTokenAmount(quote.qtyDest, i18n.locale)}{" "}
              {dstSymbol} (≈ ${formatTokenAmount(quote.usdValue, i18n.locale)})
            </Trans>
          </Text>
          <Text size="sm" c="dimmed">
            <Trans>
              Includes fee $
              {formatTokenAmount(quote.feeUsd, i18n.locale)} plus slippage $
              {formatTokenAmount(quote.slippageUsd, i18n.locale)}. Estimate at
              spot price.
            </Trans>
          </Text>
          <Text size="sm" mt={4}>
            {assetType === "RESERVE" ? (
              <Trans>
                {srcSymbol} balance: {formatTokenAmount(balance, i18n.locale)}{" "}
                →{" "}
                {formatTokenAmount(
                  Number((balance - amount).toPrecision(12)),
                  i18n.locale,
                )}
              </Trans>
            ) : (
              <Trans>
                {srcSymbol} debt: {formatTokenAmount(balance, i18n.locale)} →{" "}
                {formatTokenAmount(
                  Number((balance - amount).toPrecision(12)),
                  i18n.locale,
                )}
              </Trans>
            )}
          </Text>
        </div>
      ) : null}
      <Text size="sm" mt={8}>
        <Trans>
          Health Factor: {fmtHf(workingData?.healthFactor)} →{" "}
          {previewHf == null ? "—" : fmtHf(previewHf)}
        </Trans>
      </Text>
      <Group justify="flex-end" mt={12}>
        <Button variant="default" onClick={handleClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!quote}
          aria-label={t`Confirm swap`}
        >
          <Trans>Confirm swap</Trans>
        </Button>
      </Group>
    </Modal>
  );
}
