# 美國 FOMC 鷹鴿分數

本專案整理美國聯準會 FOMC 會議與鷹鴿分數，目前資料自 2000 年起。瀏覽圖表和計分表不需要帳號或任何額外設定：<https://dylanlu0604-dot.github.io/fomc-hawkish-score/>。

## 評分方式

總分範圍為 0–10 分，公式如下：

```text
score = clamp(5 + 3 × rateSignal + toneSignal + 2 × assetSignal + dissentAdj, 0, 10)
```

分數以 5 分為基準，結合利率決策、聲明語氣、資產負債表訊號及利率異議調整。超出範圍的結果會限制在 0 或 10 分；計分表會顯示遭限制的原始分數。

2000–2005 年資料由歷史回補流程評分；其他既有歷史分數保留原值。新會議使用 OpenAI GPT-6 Luna 判讀聲明，程式依上述公式計算分數。日常更新只處理最新一場會議，不重新評分舊會議。

## 更新方式

GitHub Actions 每天 08:30（台北時間）檢查聯準會官方日程。最新會議已存在且聲明內容沒有變更時，流程會跳過 AI 評分。2000–2005 年歷史資料則由獨立的手動回補流程處理，不會在日常更新中重跑。

一次性歷史回補的執行紀錄可在 [GitHub Actions](https://github.com/dylanlu0604-dot/fomc-hawkish-score/actions/workflows/backfill-history.yml) 查看。評分細節及官方聲明連結可在網站計分表中查閱。

## 圖表與資料

圖表顯示每場會議的原始分數、4 次與 8 次會議移動平均，以及 2 年期美國公債殖利率。表格列出各項分數、決議、聲明摘要與官方聲明連結。

主要資料檔：

- `data/fomc_hawkish_scores.csv`：歷史及最新會議分數。
- `data/statements.jsonl`：官方聲明、來源網址與 SHA-256。
- `data/ai_scoring_audit.jsonl`：AI 評分模型、提示版本、來源雜湊與時間紀錄。
- `data/us_2y_yield.csv`：FRED DGS2 2 年期美國公債殖利率。
- `docs/scoring-methodology-zh-TW.md`：評分公式與判斷規則。

聲明來源：[Federal Reserve FOMC](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)。殖利率來源：[FRED DGS2](https://fred.stlouisfed.org/series/DGS2)，每日百分比、非季節調整。

## 本機預覽

需要 Node.js 22 或更新版本。安裝套件後，從現有資料產生圖表資料並啟動靜態伺服器：

```sh
npm ci
npm run build:dashboard
npx serve site
```

`npm run update:yields` 可更新 FRED DGS2 資料。GitHub Pages 由 GitHub Actions 部署；首次發布需在 repository 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
