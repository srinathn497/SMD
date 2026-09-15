"""
Portfolio Risk Service

Computes institutional-grade risk metrics from current holdings + 1-year price history.

Metrics:
  VaR (95%)     — Historical simulation: worst 5th-percentile 1-day loss in $
  Sharpe        — Annualised excess return per unit of total volatility
  Sortino       — Annualised excess return per unit of downside volatility
  Max Drawdown  — Largest peak-to-trough portfolio loss over the period
  Beta          — Portfolio sensitivity to SPY (weighted avg of individual betas)
  Correlation   — Pairwise return correlations between holdings
  Concentration — Weight of top-1 / top-3 holdings as % of portfolio

All computations use 1-year daily log returns (252 trading days).
Risk-free rate: 5.0% annualised (US 3-month T-bill proxy).
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger("risk_service")

RISK_FREE_RATE = 0.05          # 5% annualised
TRADING_DAYS   = 252
PERIOD         = "1y"
BENCHMARK      = "SPY"


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class HoldingRisk:
    symbol:          str
    weight_pct:      float   # % of total portfolio value
    current_value:   float
    beta:            float | None
    daily_vol_pct:   float | None   # annualised volatility %
    var_contrib_pct: float | None   # this holding's contribution to portfolio VaR %


@dataclass
class CorrelationPair:
    symbol_a:    str
    symbol_b:    str
    correlation: float   # -1.0 to +1.0


@dataclass
class PortfolioRisk:
    # ── Summary metrics ────────────────────────────────────────────────────────
    var_95_dollar:          float          # 1-day 95% VaR in $
    var_95_pct:             float          # VaR as % of portfolio value
    sharpe_ratio:           float | None
    sortino_ratio:          float | None
    max_drawdown_pct:       float          # e.g. -18.5 = 18.5% drawdown
    beta:                   float | None   # portfolio beta vs SPY
    annualized_return_pct:  float
    annualized_vol_pct:     float

    # ── Holdings breakdown ────────────────────────────────────────────────────
    holdings:               list = field(default_factory=list)

    # ── Correlation matrix ────────────────────────────────────────────────────
    correlation_matrix:     list = field(default_factory=list)
    all_symbols:            list = field(default_factory=list)   # ordered list for matrix rendering

    # ── Concentration ─────────────────────────────────────────────────────────
    top1_concentration_pct:  float = 0.0
    top3_concentration_pct:  float = 0.0
    top5_concentration_pct:  float = 0.0

    # ── Metadata ──────────────────────────────────────────────────────────────
    total_portfolio_value:  float = 0.0
    period_days:            int   = 0
    risk_free_rate_pct:     float = RISK_FREE_RATE * 100
    computed_at:            str   = ""
    insufficient_data:      bool  = False
    message:                str   = ""


def _empty_risk(message: str, total_value: float = 0) -> PortfolioRisk:
    return PortfolioRisk(
        var_95_dollar=0, var_95_pct=0,
        sharpe_ratio=None, sortino_ratio=None,
        max_drawdown_pct=0, beta=None,
        annualized_return_pct=0, annualized_vol_pct=0,
        total_portfolio_value=total_value,
        insufficient_data=True,
        message=message,
        computed_at=datetime.utcnow().isoformat(),
    )


def compute_portfolio_risk(
    holdings: list[dict],   # [{'symbol': str, 'current_value': float, 'asset_type': str}]
) -> PortfolioRisk:
    """
    Main entry point. holdings is a list of dicts with symbol, current_value, asset_type.
    Returns a PortfolioRisk dataclass.
    """
    if not holdings:
        return _empty_risk("No holdings in portfolio.")

    total_value = sum(h["current_value"] for h in holdings)
    if total_value <= 0:
        return _empty_risk("Portfolio value is zero.", total_value)

    symbols = [h["symbol"] for h in holdings]
    weights = {h["symbol"]: h["current_value"] / total_value for h in holdings}

    # ── 1. Download 1-year daily price history for all symbols + SPY ──────────
    all_download = list(set(symbols + [BENCHMARK]))
    logger.info(f"[risk] Downloading {len(all_download)} symbols: {all_download}")

    try:
        raw = yf.download(
            all_download,
            period=PERIOD,
            interval="1d",
            auto_adjust=True,
            progress=False,
        )
    except Exception as e:
        logger.warning(f"[risk] Download failed: {e}")
        return _empty_risk(f"Failed to download price data: {e}", total_value)

    # Extract Close prices
    if isinstance(raw.columns, pd.MultiIndex):
        try:
            closes = raw["Close"]
        except KeyError:
            closes = raw.xs("Close", axis=1, level=0) if "Close" in raw.columns.get_level_values(0) else raw
    else:
        closes = raw  # single-symbol edge case

    if closes.empty:
        return _empty_risk("No price data returned.", total_value)

    # Drop columns with too many NaNs
    closes = closes.dropna(axis=1, thresh=int(len(closes) * 0.7))
    available_symbols = [s for s in symbols if s in closes.columns]

    if not available_symbols:
        return _empty_risk("No price data available for any holding.", total_value)

    # Log returns
    log_returns = np.log(closes / closes.shift(1)).dropna()

    period_days = len(log_returns)
    if period_days < 20:
        return _empty_risk(f"Insufficient history: only {period_days} trading days.", total_value)

    # ── 2. Portfolio daily returns (value-weighted) ───────────────────────────
    port_weights_series = pd.Series({
        s: weights.get(s, 0) for s in available_symbols
    })
    port_weights_series = port_weights_series / port_weights_series.sum()  # renormalise

    holding_returns = log_returns[available_symbols]
    port_daily_returns = (holding_returns * port_weights_series).sum(axis=1)

    # ── 3. VaR 95% (historical simulation) ───────────────────────────────────
    var_95_pct_val   = float(np.percentile(port_daily_returns, 5))   # negative number
    var_95_dollar    = abs(var_95_pct_val) * total_value
    var_95_pct_out   = abs(var_95_pct_val) * 100

    # ── 4. Sharpe & Sortino ───────────────────────────────────────────────────
    mean_daily       = float(port_daily_returns.mean())
    std_daily        = float(port_daily_returns.std())
    ann_return       = mean_daily * TRADING_DAYS * 100
    ann_vol          = std_daily  * np.sqrt(TRADING_DAYS) * 100

    rf_daily         = RISK_FREE_RATE / TRADING_DAYS
    excess_daily     = port_daily_returns - rf_daily

    sharpe = None
    if std_daily > 0:
        sharpe = round(float(excess_daily.mean() / std_daily * np.sqrt(TRADING_DAYS)), 2)

    sortino = None
    downside = port_daily_returns[port_daily_returns < 0]
    if len(downside) >= 5 and downside.std() > 0:
        sortino = round(float(excess_daily.mean() / downside.std() * np.sqrt(TRADING_DAYS)), 2)

    # ── 5. Max drawdown ───────────────────────────────────────────────────────
    cum_returns   = (1 + port_daily_returns).cumprod()
    rolling_peak  = cum_returns.cummax()
    drawdowns     = (cum_returns - rolling_peak) / rolling_peak
    max_dd        = round(float(drawdowns.min()) * 100, 2)   # negative %, e.g. -18.5

    # ── 6. Beta vs SPY ────────────────────────────────────────────────────────
    portfolio_beta = None
    individual_betas: dict[str, float | None] = {}

    if BENCHMARK in log_returns.columns:
        spy_ret = log_returns[BENCHMARK]
        spy_var = float(spy_ret.var())
        if spy_var > 0:
            # Portfolio-level beta
            cov_port_spy = float(np.cov(port_daily_returns, spy_ret)[0, 1])
            portfolio_beta = round(cov_port_spy / spy_var, 2)

            # Individual betas
            for sym in available_symbols:
                cov = float(np.cov(log_returns[sym], spy_ret)[0, 1])
                individual_betas[sym] = round(cov / spy_var, 2)

    # ── 7. Correlation matrix ─────────────────────────────────────────────────
    corr_pairs: list[CorrelationPair] = []
    if len(available_symbols) >= 2:
        corr_matrix = holding_returns.corr()
        for i, sa in enumerate(available_symbols):
            for sb in available_symbols[i + 1:]:
                if sa in corr_matrix.index and sb in corr_matrix.columns:
                    c = float(corr_matrix.loc[sa, sb])
                    if not np.isnan(c):
                        corr_pairs.append(CorrelationPair(sa, sb, round(c, 3)))

    # Full correlation dict for matrix rendering (including self)
    full_corr: list[CorrelationPair] = []
    if len(available_symbols) >= 2:
        corr_matrix = holding_returns.corr()
        for sa in available_symbols:
            for sb in available_symbols:
                if sa in corr_matrix.index and sb in corr_matrix.columns:
                    c = float(corr_matrix.loc[sa, sb])
                    if not np.isnan(c):
                        full_corr.append(CorrelationPair(sa, sb, round(c, 3)))

    # ── 8. Per-holding risk breakdown ─────────────────────────────────────────
    holding_risks: list[HoldingRisk] = []
    sorted_holdings = sorted(holdings, key=lambda h: -h["current_value"])

    for h in sorted_holdings:
        sym = h["symbol"]
        w   = weights.get(sym, 0) * 100

        beta_val = individual_betas.get(sym)

        sym_vol = None
        var_contrib = None
        if sym in log_returns.columns:
            sym_std = float(log_returns[sym].std())
            sym_vol = round(sym_std * np.sqrt(TRADING_DAYS) * 100, 1)
            sym_var_pct = abs(float(np.percentile(log_returns[sym], 5))) * 100
            var_contrib = round(sym_var_pct * (h["current_value"] / total_value) * 100, 2)

        holding_risks.append(HoldingRisk(
            symbol=sym,
            weight_pct=round(w, 1),
            current_value=round(h["current_value"], 2),
            beta=beta_val,
            daily_vol_pct=sym_vol,
            var_contrib_pct=var_contrib,
        ))

    # ── 9. Concentration ──────────────────────────────────────────────────────
    sorted_weights = sorted([weights[s] * 100 for s in available_symbols], reverse=True)
    top1 = round(sorted_weights[0], 1)                           if len(sorted_weights) >= 1 else 0.0
    top3 = round(sum(sorted_weights[:3]), 1)                     if len(sorted_weights) >= 1 else 0.0
    top5 = round(sum(sorted_weights[:5]), 1)                     if len(sorted_weights) >= 1 else 0.0

    return PortfolioRisk(
        var_95_dollar         = round(var_95_dollar, 2),
        var_95_pct            = round(var_95_pct_out, 2),
        sharpe_ratio          = sharpe,
        sortino_ratio         = sortino,
        max_drawdown_pct      = max_dd,
        beta                  = portfolio_beta,
        annualized_return_pct = round(ann_return, 1),
        annualized_vol_pct    = round(ann_vol, 1),
        holdings              = holding_risks,
        correlation_matrix    = full_corr,
        all_symbols           = available_symbols,
        top1_concentration_pct = top1,
        top3_concentration_pct = top3,
        top5_concentration_pct = top5,
        total_portfolio_value = round(total_value, 2),
        period_days           = period_days,
        risk_free_rate_pct    = RISK_FREE_RATE * 100,
        computed_at           = datetime.utcnow().isoformat(),
        insufficient_data     = False,
        message               = f"Computed from {period_days} trading days across {len(available_symbols)} symbols.",
    )
