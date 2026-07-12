# HushLedger AI 銀行紀錄貼上匯入計畫

## 目標與交付次序

目前已交付的最小 AI 功能是：使用者把網上銀行的純文字交易紀錄貼進應用程式，
由 AI 整理為可編輯草稿。現有版本在草稿檢閱停止，**沒有 AI 匯入 D1 的路徑**。
批次確認、duplicate detection 及 atomic commit 仍要在 Phase 2B 完成後才加入。

建議交付次序：

1. **Phase 2A — 自訂主資料**：新增、改名、停用銀行／現金／電子錢包／信用卡
   帳戶，以及收入／支出分類。既有交易仍保留原 account/category reference。
2. **Phase 2B — 匯入基礎**：建立 import batch、duplicate detection、review table
   及不依賴 AI 的 deterministic commit pipeline。
3. **Phase 2C-preview — AI 解析器（已交付）**：接駁使用者提供的
   OpenAI-compatible endpoint，支援貼上網上銀行純文字並產生不寫入 D1 的
   transaction drafts。
4. **Phase 2C-commit（未交付）**：把 2B 的 review batch、duplicate detection 及
   atomic commit 接到已驗證的草稿。

第一版不包括 PDF／截圖 OCR、直接連接銀行、背景自動同步或無人確認的自動
入帳。信用卡還款及帳戶之間轉帳在 transfer model 完成前只會被標示為「可能
是轉帳」，不會自動當作一般收入或支出。

## 不可跨越的安全邊界

- AI **永不直接寫入 D1**；只回傳不受信任的 draft JSON。
- Worker 使用 Zod 驗證模型輸出，再以既有 minor-unit parser 產生 authoritative
  `amountMinor`。模型輸出的浮點數或資料庫 ID 一律不可信。
- 使用者在 review 畫面確認／修正 account、type、category、date、payee、amount
  後，才可呼叫 commit endpoint。
- 使用者提供的 base URL、API key 及 model 只保留在目前 browser tab 的 React
  memory，並只在同源 `POST` request 傳到 HushLedger server。重新載入／關閉分頁
  即清除；不使用 local/session storage、cookie、D1、Worker global 或 deployment
  config 持久化。
- UI 在送出前清楚提示：貼上的銀行文字會傳給已設定的 AI provider；取消即不
  傳送。
- 不儲存原始銀行文字，不記錄 request body、完整 payee、note 或模型原文；
  import audit 只保留 hash、provider/model identifier、筆數、狀態及時間。

OpenAI 官方建議不要在 browser application 內嵌／部署 API key，並應經自有
backend 呼叫。HushLedger 的 BYOK 設計不把 key 放進 bundle 或 persistent storage，
但使用者輸入的 key 在該 tab runtime memory 仍可被該頁面的 JavaScript 使用；因此
要維持嚴格 CSP、同源 proxy 及短生命週期，並清楚說明這個 trade-off。Structured
Outputs 可約束 JSON schema；即使使用 strict schema，Worker 仍必須再次驗證：

- [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safet)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Chat Completions API](https://developers.openai.com/api/reference/resources/chat)

## 使用流程

### 1. 貼上

使用者選擇目標帳戶、statement locale／日期格式及預設貨幣，再貼上最多 64 KiB
純文字。畫面先在 browser 顯示字元數及私隱提示，不在 local storage 暫存。

現有 mutation route 的全域 body cap 維持 16 KiB。`POST /api/imports/parse` 的 raw
JSON request cap 獨立設為 512 KiB，因為 JSON escaping、provider settings 及多位元
UTF-8 會令 request 大於原文。Zod parse 後再獨立驗證 `statementText` 不超過
64 KiB UTF-8；任一上限超過都在呼叫 provider 前回傳 `413`。其他 mutation 不會
因匯入功能而放寬。

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
POST /api/ai/models
POST /api/imports/parse
```

`POST /api/imports/commit` 及 `GET /api/imports/:batchId` 仍未交付。

`POST /api/ai/models` 接受 base URL 及 API key，固定呼叫
`GET {baseUrl}/models`，只回傳最多 200 個經驗證及去重的 model ID。若 provider
不支援此 endpoint，使用者仍可手動輸入 model ID。

`POST /api/imports/parse` request：

```json
{
  "provider": {
    "baseUrl": "https://provider.example/v1",
    "apiKey": "<current-tab BYOK>",
    "model": "provider-model-id"
  },
  "accountId": 2,
  "currency": "HKD",
  "dateOrder": "DMY",
  "statementText": "..."
}
```

它只回傳目前畫面的 editable drafts，不建立 review batch 或 transaction。模型草稿
的 canonical schema：

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
      "confidence": 0.92,
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
5. 以原文行號產生 bounded source excerpt；不保存 statement 或 provider 原始回應。

未來的 `POST /api/imports/commit` 只接受已 parse 的 `batchId` 及經使用者確認的
normalized rows。每列再做與單筆新增交易相同的 server-side 驗證。

## OpenAI-compatible provider adapter

Provider 差異集中在無 SDK dependency 的 server `fetch` adapter。使用者在 Settings
輸入 base URL、API key 及 model；adapter 的第一個 compatibility target 固定使用
`POST {baseUrl}/chat/completions` 及 strict `json_schema`。目前不支援 Responses API、
`json_object` 或 prompt-only JSON，失敗時亦不會靜默降低約束。

正式啟用前以無敏感資料做 capability smoke test，驗證：

- authentication header 及 endpoint path
- 所選 model 是否接受 system/user messages
- `response_format`／strict JSON schema 支援程度
- timeout、rate-limit、refusal 及 malformed JSON 的實際回應格式

Model discovery 使用 10 秒 timeout／64 KiB response cap；parse 使用 30 秒 timeout／
256 KiB response cap，兩者都沒有自動 retry，並設定 `redirect: error` 及
`Cache-Control: no-store`。Production 只接受 public HTTPS port 443 provider；
本機 `npm run dev` 額外容許不同 port 的 loopback HTTP／HTTPS，而 workerd preview 維持
public-only outbound routing。固定 path、拒絕 URL
credentials/query/fragment/IP/private/same-app target，並保留 Cloudflare
`global_fetch_strictly_public` defense-in-depth。

銀行文字會被標記為 untrusted data，prompt 明確禁止遵從其中的指令；adapter 不
提供 tools、web、file 或 database capability，亦不接受 D1 handle。

## D1 資料設計

以下是未來 atomic commit 所需設計；目前沒有加入 migration。新增
`import_batches`：

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
- no sensitive logs、no bundled/persisted browser key、Origin／Access boundary、
  512 KiB raw request 及 64 KiB decoded statement cap

目前 Phase 2C-preview 的完成條件：

1. 使用者可以貼上真實格式但匿名化的銀行文字，看到可修改的草稿。
2. AI failure 不會建立 transaction，亦不會遺失已在畫面中的原文。
3. 所有 authoritative 金額均由 Worker minor-unit parser 產生。
4. Parser 永遠零 D1 writes，API key 不會進入 storage、bundle、Git、logs、
   screenshots 或 fixtures。

完整 Phase 2C 仍要額外證明：確認後 totals 與 review 一致、duplicate／idempotency、
atomic commit failure、keyboard/mobile commit review 及 retention cleanup。
