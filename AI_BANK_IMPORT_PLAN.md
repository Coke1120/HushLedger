# HushLedger AI 銀行紀錄貼上匯入計畫

## 目標與交付次序

Phase 1 核心收支流程穩定後，下一個最小可用 AI 功能是：使用者把網上銀行的
純文字交易紀錄貼進應用程式，由 AI 整理為可編輯草稿，經使用者逐筆確認後才
批次匯入 D1。

建議交付次序：

1. **Phase 2A — 自訂主資料**：新增、改名、停用銀行／現金／電子錢包／信用卡
   帳戶，以及收入／支出分類。既有交易仍保留原 account/category reference。
2. **Phase 2B — 匯入基礎**：建立 import batch、duplicate detection、review table
   及不依賴 AI 的 deterministic commit pipeline。
3. **Phase 2C — AI 解析器**：接駁使用者提供的 OpenAI-compatible endpoint，
   支援貼上網上銀行純文字並產生 transaction drafts。

第一版不包括 PDF／截圖 OCR、直接連接銀行、背景自動同步或無人確認的自動
入帳。信用卡還款及帳戶之間轉帳在 transfer model 完成前只會被標示為「可能
是轉帳」，不會自動當作一般收入或支出。

## 不可跨越的安全邊界

- AI **永不直接寫入 D1**；只回傳不受信任的 draft JSON。
- Worker 使用 Zod 驗證模型輸出，再以既有 minor-unit parser 產生 authoritative
  `amountMinor`。模型輸出的浮點數或資料庫 ID 一律不可信。
- 使用者在 review 畫面確認／修正 account、type、category、date、payee、amount
  後，才可呼叫 commit endpoint。
- `AI_API_KEY`、base URL、model 及 compatibility mode 只存在 Worker secrets／
  deployment config；不傳送到 React、不放入 repository、不由 request 指定。
- UI 在送出前清楚提示：貼上的銀行文字會傳給已設定的 AI provider；取消即不
  傳送。
- 不儲存原始銀行文字，不記錄 request body、完整 payee、note 或模型原文；
  import audit 只保留 hash、provider/model identifier、筆數、狀態及時間。

OpenAI 官方亦要求 API key 不應暴露於 browser，並建議經自有 backend 及環境
變數使用。Structured Outputs 可在 provider/model 支援時約束 JSON schema；
即使使用 strict schema，Worker 仍必須再次驗證：

- [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safet)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Chat Completions API](https://developers.openai.com/api/reference/resources/chat)

## 使用流程

### 1. 貼上

使用者選擇目標帳戶、statement locale／日期格式及預設貨幣，再貼上最多 64 KiB
純文字。畫面先在 browser 顯示字元數及私隱提示，不在 local storage 暫存。

現有 mutation route 的全域 body cap 維持 16 KiB。Phase 2C 必須只為
`POST /api/imports/parse` 加入獨立的 `MAX_IMPORT_PARSE_BYTES = 64 * 1024` reader／
middleware；其他 mutation（包括 `/api/imports/commit`）不得因匯入功能而放寬。
超過 64 KiB 的 parse request 在呼叫 provider 前回傳 `413`。

### 2. 檢閱

Worker 回傳逐筆草稿；UI 以 table／mobile cards 顯示：

- 原文行號及簡短原文摘錄
- 日期、收支方向、HKD 金額、payee／description
- 建議分類、信心程度、警告
- `可能重複`、`日期不明確`、`可能是轉帳／信用卡還款` 等狀態

使用者可批量選分類，亦可逐筆修改、排除或保留。任何 validation error 都在該
列旁顯示，不以 toast 取代欄位錯誤。

### 3. 確認匯入

確認頁先顯示筆數及收入／支出合計。commit request 使用 `batchId` 作 idempotency
key；Worker 在單一 D1 batch 中重新驗證並寫入，回傳 imported、skipped duplicate
及 rejected counts。重試相同 batch 不會重複入帳。

## Worker API 合約

```text
POST /api/imports/parse
POST /api/imports/commit
GET  /api/imports/:batchId
```

`POST /api/imports/parse` request：

```json
{
  "accountId": 2,
  "currency": "HKD",
  "dateOrder": "DMY",
  "statementText": "..."
}
```

它只建立 review batch，不建立 transaction。模型草稿的 canonical schema：

```json
{
  "rows": [
    {
      "sourceLine": 1,
      "occurredOn": "2026-07-11",
      "direction": "expense",
      "amountText": "123.45",
      "currency": "HKD",
      "description": "Example merchant",
      "suggestedCategoryName": "餐飲",
      "confidence": "high",
      "flags": []
    }
  ]
}
```

模型不可回傳 authoritative `amountMinor`、`accountId` 或 `categoryId`。Worker 會：

1. 限制 row count、string length 及 response bytes。
2. Zod parse JSON，拒絕額外欄位。
3. 依 `currency` minor units deterministic parse `amountText`。
4. 驗證日期及目標帳戶；分類名稱只作 suggestion，不直接建立分類。
5. 計算 duplicate fingerprint 及 preview totals。

`POST /api/imports/commit` 只接受已 parse 的 `batchId` 及經使用者確認的 normalized
rows。每列再做與單筆新增交易相同的 server-side 驗證。

## OpenAI-compatible provider adapter

避免把第三方 provider 差異散落在 route handler，建立一個無 SDK dependency 的
Worker `fetch` adapter。部署設定：

```text
AI_API_BASE_URL=https://provider.example/v1
AI_API_KEY=<Worker secret>
AI_MODEL=<provider model id>
AI_API_MODE=chat_completions|responses
AI_STRUCTURED_OUTPUT_MODE=json_schema|json_object|prompt_json
```

第一個 compatibility target 使用 `POST {baseUrl}/chat/completions`。若 provider
正式支援 Responses API，才選 `responses`。`json_schema` 是首選；不支援時必須
由部署者明確選擇 fallback，程式不可在失敗後靜默降低約束。

正式啟用前以無敏感資料做 capability smoke test，驗證：

- authentication header 及 endpoint path
- 所選 model 是否接受 system/user messages
- `response_format`／strict JSON schema 支援程度
- timeout、rate-limit、refusal 及 malformed JSON 的實際回應格式

所有請求使用固定 timeout、無重試或最多一次可控重試、`Cache-Control: no-store`、
response byte cap。銀行文字會被標記為 untrusted data，prompt 明確禁止遵從其中的
指令；adapter 不提供 tools、web、file 或 database capability。

Secret 設定只使用 placeholder 指令，不把真實值寫進 shell history 或文件：

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_API_BASE_URL
```

`AI_MODEL`、mode 等非敏感選項可放在 environment-specific Wrangler vars；若 model
名稱本身屬私隱，也改用 secret。

## D1 資料設計

新增 `import_batches`：

```text
id, account_id, source_sha256, provider_label, model_label,
status, draft_count, imported_count, duplicate_count, rejected_count,
created_at, committed_at
```

新增 `import_rows` 或等價 staging table，保存 normalized draft 及 review state，
不保存完整 statement text。`transactions` 增加 nullable `import_batch_id` 及
`source_fingerprint`。

Staging retention 是資料合約的一部分：取消或成功 commit 時立即刪除對應
`import_rows`；未完成 batch 及 rows 由每日 cleanup 在建立 24 小時後刪除。
已完成的 `import_batches` 只保留不含 payee／note／原文的 hash、provider/model、
counts、status 及 timestamps 90 日，之後刪除；`transactions.import_batch_id` 使用
nullable `ON DELETE SET NULL`，交易本身仍保留。Cleanup 必須可重試、分批執行，
並有 clock-boundary 及 interrupted-run tests。

duplicate fingerprint 由 server 以以下 normalized 欄位產生：

```text
accountId + occurredOn + amountMinor + direction + normalized payee + bank reference
```

若沒有 bank reference，UI 必須以「可能重複」而非「一定重複」表示。Database
unique constraint 配合 batch idempotency 防止同一次確認重複寫入；跨 batch 的
相似項目交由使用者決定。

## 測試矩陣與完成定義

CI 只使用 fake provider，不使用真實 API key。至少覆蓋：

- 香港常見 `DD/MM/YYYY`、兩位年份、跨月及 ambiguous dates
- 逗號、貨幣符號、括號負數、`CR`／`DR`、debit／credit 欄
- statement headers、opening/closing balance、totals 及多行 description
- income、expense、refund、fee、cash withdrawal、FPS 及可能 transfer
- 中英混合 payee、emoji、超長行、空白、零金額及非 HKD
- prompt injection、HTML／CSV-like payload、malformed／oversized model output
- provider timeout、401、429、5xx、refusal、invalid JSON 及 schema mismatch
- duplicate preview、同 batch 重試、部分排除、全部排除及 atomic commit failure
- no sensitive logs、no browser key、Origin／Access boundary、64 KiB input cap

Phase 2C 只在以下全部成立才算完成：

1. 使用者可以貼上真實格式但匿名化的銀行文字，看到可修改的草稿。
2. AI failure 不會建立 transaction，亦不會遺失已在畫面中的原文。
3. 所有 authoritative 金額均由 Worker minor-unit parser 產生。
4. 使用者確認前零 D1 transaction writes；確認後 totals 與 review 完全一致。
5. duplicate／idempotency、錯誤狀態、keyboard/mobile review 均有自動及 browser
   驗證。
6. frontend bundle、Git、logs、screenshots 及 test fixtures 都沒有 API key 或真實
   銀行資料。
