# 美國 FOMC 鷹鴿分數

本 repository 保存 2006 年起的既有 FOMC 分數，並自動爬取 Federal Reserve 官方日程及最新聲明。新會議只會評最新一場；既有歷史分數不會重新計算。

## 自動更新流程

GitHub Actions 每天 08:30 台北時間檢查官方 FOMC 日程，也可以從 Actions 手動執行。若最新聲明已存檔且分數已存在，流程不呼叫 AI。若發現新會議，Anthropic 只會讀最新聲明及前一列分數作為背景，產生計分欄位；程式再依 v4 權重計算最終分數。

公式沿用既有版本：

score = clamp(5 + 3 × rateSignal + toneSignal + 2 × assetSignal + dissentAdj, 0, 10)

其中 rateSignal 以 75bp 為滿分升降息訊號；toneSignal 為 AI 判讀的文字語氣；assetSignal 依既有資產負債表工具分類；明確利率異議由程式從聲明稿抽取。歷史分數沿用原有人工判讀，新會議使用 Anthropic 判讀；新分數不會回填或重算舊會議。

## 設定 Anthropic API

在 GitHub repository 的 **Settings → Secrets and variables → Actions → New repository secret** 新增：

- Name: ANTHROPIC_API_KEY
- Secret: 你的 Anthropic API key

模型預設使用 claude-sonnet-5-5。若要指定其他模型，可在同一頁面的 **Variables** 新增 ANTHROPIC_MODEL。API key 只存於 GitHub Secret，不要放進程式碼、CSV 或 commit。

需要立即更新時，打開 **Actions → Update latest FOMC score → Run workflow**。新聲明發布後會由每日排程自動處理；成功更新時，Actions 會提交聲明稿、來源雜湊、AI 稽核紀錄及最新分數。

## 資料檔

- data/fomc_hawkish_scores.csv：歷史及最新分數，欄位沿用 v4。
- data/statements.jsonl：已抓取的官方聲明稿、網址與 SHA-256。
- data/ai_scoring_audit.jsonl：新評分的模型、提示版本、來源雜湊與評分時間；初始歷史分數只會標記為保留既有分數。
- docs/scoring-methodology-zh-TW.md：原有 v4 公式及判斷規則。
- data/us_2y_yield.csv：FRED DGS2 每日 2 年期美國公債殖利率。
- site/index.html：FOMC 圖表與計分表頁面；圖表使用原始分數及 4／8 次會議移動平均。

## 圖表頁面與 GitHub Pages

頁面把分數按會議日期延續至下一次會議，並與每日 DGS2 殖利率使用雙軸呈現。4／8 次均線是最近 4／8 場 FOMC 會議的等權平均。表格保留完整分數、決議、摘要及官方聲明連結。

`npm run update:yields` 會更新 FRED DGS2；`npm run build:dashboard` 會從分數、聲明及殖利率來源檔產生 `site/data/dashboard.json`。GitHub Actions 會更新資料；只有在 repository variable `PUBLISH_GITHUB_PAGES=true` 時才會部署頁面。首次發布前，請在 repository 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**，再啟用該 variable。GitHub Pages 通常會讓網站可公開瀏覽；請先確認 repository 及網站的可見性符合預期。

本機產生頁面資料後，可用任一靜態伺服器從 `site/` 預覽：

    npm run update:yields
    npm run build:dashboard
    npx serve site

殖利率來源：Board of Governors of the Federal Reserve System via [FRED DGS2](https://fred.stlouisfed.org/series/DGS2)，每日百分比、非季節調整。

## 本機執行

需要 Node.js 22 或更新版本。第一次安裝套件後執行：

    npm ci
    ANTHROPIC_API_KEY=你的金鑰 npm run update

如果最新會議已存在且聲明內容沒有變更，就不會呼叫 Anthropic。需要的 API 端點與訊息格式依據 [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)；可用模型見 [Anthropic Models](https://platform.claude.com/docs/en/models/overview)。
