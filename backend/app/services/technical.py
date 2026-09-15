import pandas as pd
import pandas_ta as ta

from app.schemas.signals import IndicatorSignal, SignalResult


class TechnicalAnalysis:
    def compute_all(self, df: pd.DataFrame, symbol: str, asset_type: str) -> SignalResult:
        if len(df) < 52:
            raise ValueError(f"Not enough data for {symbol}: need at least 52 bars, got {len(df)}")

        df = df.copy()
        df.columns = [c.lower() for c in df.columns]

        current_price = float(df["close"].iloc[-1])
        indicators: list[IndicatorSignal] = []

        # ------------------------------------------------------------------
        # 1. RSI (14)
        # ------------------------------------------------------------------
        rsi_series = ta.rsi(df["close"], length=14)
        rsi = float(rsi_series.iloc[-1]) if rsi_series is not None and not rsi_series.empty else None
        if rsi is not None:
            if rsi < 30:
                rsi_signal, rsi_detail = "BUY", f"RSI {rsi:.1f} — oversold (<30)"
            elif rsi > 70:
                rsi_signal, rsi_detail = "SELL", f"RSI {rsi:.1f} — overbought (>70)"
            else:
                rsi_signal, rsi_detail = "HOLD", f"RSI {rsi:.1f} — neutral (30-70)"
            indicators.append(IndicatorSignal(name="RSI(14)", value=round(rsi, 2), signal=rsi_signal, detail=rsi_detail))

        # ------------------------------------------------------------------
        # 2. MACD (12, 26, 9)
        # ------------------------------------------------------------------
        macd_df = ta.macd(df["close"], fast=12, slow=26, signal=9)
        if macd_df is not None and len(macd_df) >= 2:
            macd_col = [c for c in macd_df.columns if c.startswith("MACD_")]
            sig_col = [c for c in macd_df.columns if c.startswith("MACDs_")]
            hist_col = [c for c in macd_df.columns if c.startswith("MACDh_")]
            if macd_col and sig_col and hist_col:
                macd_val = float(macd_df[macd_col[0]].iloc[-1])
                sig_val = float(macd_df[sig_col[0]].iloc[-1])
                hist_now = float(macd_df[hist_col[0]].iloc[-1])
                hist_prev = float(macd_df[hist_col[0]].iloc[-2])

                if hist_prev < 0 and hist_now > 0:
                    macd_signal, macd_detail = "BUY", f"MACD bullish crossover (hist: {hist_now:.4f})"
                elif hist_prev > 0 and hist_now < 0:
                    macd_signal, macd_detail = "SELL", f"MACD bearish crossover (hist: {hist_now:.4f})"
                elif macd_val > sig_val:
                    macd_signal, macd_detail = "BUY", f"MACD above signal ({macd_val:.4f} > {sig_val:.4f})"
                elif macd_val < sig_val:
                    macd_signal, macd_detail = "SELL", f"MACD below signal ({macd_val:.4f} < {sig_val:.4f})"
                else:
                    macd_signal, macd_detail = "HOLD", "MACD at signal line"

                indicators.append(IndicatorSignal(
                    name="MACD(12,26,9)", value=round(hist_now, 6), signal=macd_signal, detail=macd_detail
                ))

        # ------------------------------------------------------------------
        # 3. Bollinger Bands (20, 2)
        # ------------------------------------------------------------------
        bb_df = ta.bbands(df["close"], length=20, std=2.0)
        if bb_df is not None and not bb_df.empty:
            lower_col = [c for c in bb_df.columns if c.startswith("BBL_")]
            upper_col = [c for c in bb_df.columns if c.startswith("BBU_")]
            pct_col = [c for c in bb_df.columns if c.startswith("BBP_")]
            if lower_col and upper_col:
                bb_lower = float(bb_df[lower_col[0]].iloc[-1])
                bb_upper = float(bb_df[upper_col[0]].iloc[-1])
                bb_pct = float(bb_df[pct_col[0]].iloc[-1]) if pct_col else None

                if current_price <= bb_lower:
                    bb_signal, bb_detail = "BUY", f"Price at/below lower band ({bb_lower:.4f})"
                elif current_price >= bb_upper:
                    bb_signal, bb_detail = "SELL", f"Price at/above upper band ({bb_upper:.4f})"
                else:
                    bb_signal, bb_detail = "HOLD", f"Price inside bands ({bb_lower:.4f} – {bb_upper:.4f})"

                indicators.append(IndicatorSignal(
                    name="BB(20,2)", value=round(bb_pct, 4) if bb_pct else None,
                    signal=bb_signal, detail=bb_detail
                ))

        # ------------------------------------------------------------------
        # 4. EMA crossover (20 / 50)
        # ------------------------------------------------------------------
        ema20 = ta.ema(df["close"], length=20)
        ema50 = ta.ema(df["close"], length=50)
        if ema20 is not None and ema50 is not None and len(ema20) >= 2 and len(ema50) >= 2:
            e20_now, e20_prev = float(ema20.iloc[-1]), float(ema20.iloc[-2])
            e50_now, e50_prev = float(ema50.iloc[-1]), float(ema50.iloc[-2])

            if e20_prev <= e50_prev and e20_now > e50_now:
                ema_signal, ema_detail = "BUY", f"Golden cross: EMA20 ({e20_now:.4f}) crossed above EMA50 ({e50_now:.4f})"
            elif e20_prev >= e50_prev and e20_now < e50_now:
                ema_signal, ema_detail = "SELL", f"Death cross: EMA20 ({e20_now:.4f}) crossed below EMA50 ({e50_now:.4f})"
            elif e20_now > e50_now:
                ema_signal, ema_detail = "BUY", f"EMA20 ({e20_now:.4f}) above EMA50 ({e50_now:.4f})"
            else:
                ema_signal, ema_detail = "SELL", f"EMA20 ({e20_now:.4f}) below EMA50 ({e50_now:.4f})"

            indicators.append(IndicatorSignal(
                name="EMA(20/50)", value=round(e20_now - e50_now, 4), signal=ema_signal, detail=ema_detail
            ))

        # ------------------------------------------------------------------
        # Aggregate: majority vote
        # ------------------------------------------------------------------
        buy_count = sum(1 for i in indicators if i.signal == "BUY")
        sell_count = sum(1 for i in indicators if i.signal == "SELL")
        hold_count = sum(1 for i in indicators if i.signal == "HOLD")
        total = len(indicators)

        if total == 0:
            agg_signal = "HOLD"
            confidence = 0.0
        elif buy_count > sell_count and buy_count > hold_count:
            agg_signal = "BUY"
            confidence = round(buy_count / total * 100, 1)
        elif sell_count > buy_count and sell_count > hold_count:
            agg_signal = "SELL"
            confidence = round(sell_count / total * 100, 1)
        else:
            agg_signal = "HOLD"
            confidence = round(hold_count / total * 100, 1) if hold_count else 50.0

        return SignalResult(
            symbol=symbol,
            asset_type=asset_type,
            current_price=current_price,
            aggregate_signal=agg_signal,
            confidence_pct=confidence,
            buy_count=buy_count,
            sell_count=sell_count,
            hold_count=hold_count,
            indicators=indicators,
        )


technical_analysis = TechnicalAnalysis()
