# HushLedger AI 銀行紀錄貼上匯入計畫

## 目標與交付次序

目前已交付完整的人工確認流程：使用者把網上銀行純文字交易紀錄貼進應用程式，
由 AI 整理為可編輯草稿；HushLedger 再以 live D1 狀態檢查重複項目、帳戶及分類，
最後只在使用者明確選擇後 atomic commit。解析階段維持 **零 D1 writes**，模型亦
永遠不能直接呼叫 commit。使用者可另外明確儲存 AI provider 連線設定；這是設定
寫入，不是 transaction import 寫入。

建議交付次序：

1. **Phase 2A — 自訂主資料**：新增、改名、停用銀行／現金／電子錢包／信用卡
   帳戶，以及收入／支出分類。既有交易仍保留原 account/category reference。
2. **Phase 2B — 匯入基礎（已交付）**：建立 deterministic duplicate preview、
   stable source tombstone 及不依賴 AI 的 atomic commit pipeline。
3. **Phase 2C-preview — AI 解析器（已交付）**：接駁使用者提供的
   OpenAI-compatible endpoint，支援貼上網上銀行純文字並產生不寫入 D1 的
   transaction drafts。
4. **Phase 2C-commit（已交付）**：把 2B 的 duplicate preview、人工選擇及 atomic
   commit 接到已驗證及可修改的草稿。

第一版不包括 PDF／截圖 OCR、直接連接銀行、背景自動同步或無人確認的自動
入帳。信用卡還款及帳戶之間轉帳在 transfer model 完成前只會被標示為「可能
是轉帳」，不會自動當作一般收入或支出。

## 不可跨越的安全邊界

- AI model／parser **永不直接寫入 ledger tables**；只回傳不受信任的 draft JSON。
- Worker 使用 Zod 驗證模型輸出，再以既有 minor-unit parser 產生 authoritative
  `amountMinor`。模型輸出的浮點數或資料庫 ID 一律不可信。
- 使用者在 review 畫面確認／修正 account、type、category、date、payee、amount
  後，才可呼叫 commit endpoint。
- 使用者可選擇把 base URL、API key 及 model 只保留在目前 browser tab 的 React
  memory，重新載入／關閉分頁即清除；亦可明確儲存設定。儲存時 base URL 及 model
  寫入 D1，API key 只以 AES-GCM ciphertext、隨機 IV 及 key version 儲存。
- 加密使用 operator 管理、與 D1 分離的 Worker secret
  `AI_SETTINGS_ENCRYPTION_KEY_V1`；值必須是 64 個 hexadecimal characters（32
  bytes）。Browser／settings API 只收到 redacted metadata；AI proxy route 在 server
  端才讀取及解密已儲存的 credential。
- 兩種模式都不把 plaintext API key 寫入 local/session storage、cookie、D1、URL、
  log、screenshot 或 fixture。刪除 D1 設定不等於撤銷 provider credential；需要即時
  失效時必須在 provider 端 rotate／revoke。
- UI 在送出前清楚提示：貼上的銀行文字會傳給已設定的 AI provider；取消即不
  傳送。
- 不儲存原始銀行文字，不記錄 request body、完整 payee、note 或模型原文；D1
  只額外保留不可逆 source key、transaction ID 及匯入時間作 re-import tombstone。

OpenAI 官方建議不要在 browser application 內嵌／部署 API key，並應經自有
backend 呼叫。HushLedger 的 BYOK 設計不把 key 放進 bundle 或 browser persistent
storage；transient key 在該 tab runtime memory 可被該頁面的 JavaScript 使用，saved
key 則由 server route 解密。因此要維持嚴格 CSP、同源 proxy、redacted response 及
明確的 persistence 選擇，並清楚說明這個 trade-off。Structured
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
- 日期、收支方向、帳本幣別金額、payee／description
- 建議分類、信心程度、警告
- `可能重複`、`日期不明確`、`可能是轉帳／信用卡還款` 等狀態

使用者可逐筆修改、排除或保留。任何 validation error 都在該列旁顯示，不以
toast 取代欄位錯誤。每次解析後自動 preview；任何欄位修改都令 preview 失效，
儲存前必須重新檢查。

### 3. 確認匯入

確認區顯示 new、possible duplicate、skipped 及 blocked 筆數。新交易預設選取；
可能重複預設不選，必須由使用者明確勾選。commit request 帶同已檢閱 rows 及 stable
source key；Worker 在寫入前重新 preview，並以單一 D1 `batch()` 寫入交易及
tombstone。任何 statement 失敗會令整批 rollback；重送同一 source key 不會重複
入帳。

## Worker API 合約

```text
GET /api/ai-settings
PUT /api/ai-settings
DELETE /api/ai-settings
POST /api/ai/models
POST /api/imports/parse
POST /api/imports/ai
```

AI settings endpoint 只回傳 base URL、model、`hasApiKey` 及版本 timestamps；不回傳
plaintext API key、ciphertext 或 IV。`PUT` 以 `updatedAt` 做 optimistic concurrency，
`DELETE` 只刪除 D1 row，不會通知或撤銷 upstream provider key。

`POST /api/ai/models` 接受 transient base URL/API key 或已儲存設定的 version token，
固定呼叫 `GET {baseUrl}/models`，只回傳最多 200 個經驗證及去重的 model ID。若
provider 不支援此 endpoint，使用者仍可手動輸入 model ID。

`POST /api/imports/parse` request：

```json
{
  "provider": {
    "source": "transient",
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

使用已儲存設定時，browser 改為傳送 redacted row 的版本 token：

```json
{
  "provider": {
    "source": "stored",
    "expectedUpdatedAt": "2026-07-31T12:34:56.789Z"
  },
  "accountId": 2,
  "currency": "HKD",
  "dateOrder": "DMY",
  "statementText": "..."
}
```

Route 只在 version 仍相符時於 server 端載入及解密 credential，避免 stale tab 使用
已變更的 provider 設定。

它只回傳目前畫面的 editable drafts，不建立 transaction。模型草稿的 canonical
schema：

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
5. 以 account、原文行號、原文及同列 occurrence 的 SHA-256 產生 stable source key；
   不保存 statement 或 provider 原始回應。

`POST /api/imports/ai` 只接受已 parse、在 browser 編輯後再經 strict schema 驗證的
normalized rows，支援 `preview` 及 `commit` mode。每列重新檢查 active account、
active category/type、transaction ID、exact duplicate 及 source tombstone；最多 200
列、raw JSON 最多 256 KiB。

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

Migration `0021_ai_provider_settings.sql` 新增單一 row 的
`ai_provider_settings` table。`base_url`、`model`、timestamps 保留設定 metadata；
`api_key_ciphertext`、`api_key_iv` 及 `encryption_key_version` 保存 AES-GCM 結果，D1
沒有 plaintext API key。此 table 刻意不進 app ledger JSON backup／restore；完整 D1
export 及 Time Travel history 可保留 ciphertext row。

Migration `0007_transaction_import_keys.sql` 新增：

```text
transaction_import_keys(import_key PRIMARY KEY, transaction_id, imported_at)
```

此表刻意沒有 transaction foreign key。使用者刪除已匯入交易後，source key 仍是
tombstone，避免同一銀行原文在下一次 AI 解析時靜默復活。它不保存原文、provider、
model、payee、note 或 plaintext API key，也不需要 staging/retention cleanup。

Live duplicate preview 另外比較以下 authoritative transaction 欄位：

```text
accountId + categoryId + occurredOn + amountMinor + direction + currency + payee + note
```

若只有 exact field match 而沒有相同 source key，UI 以「可能重複」而非「一定
重複」表示。`import_key` unique constraint 配合 transactional D1 batch 防止相同
來源重複寫入；跨來源的相似項目交由使用者決定。

## 測試矩陣與完成定義

CI 只使用 fake provider，不使用真實 API key。至少覆蓋：

- 香港常見 `DD/MM/YYYY`、兩位年份、跨月及 ambiguous dates
- 逗號、貨幣符號、括號負數、`CR`／`DR`、debit／credit 欄
- statement headers、opening/closing balance、totals 及多行 description
- income、expense、refund、fee、cash withdrawal、FPS 及可能 transfer
- 中英混合 payee、emoji、超長行、空白、零金額及非帳本幣別
- prompt injection、HTML／CSV-like payload、malformed／oversized model output
- provider timeout、401、429、5xx、refusal、invalid JSON 及 schema mismatch
- duplicate preview、stable re-analysis、部分排除、全部排除及 atomic commit failure
- no sensitive logs、no bundled/persisted browser key、settings response redaction、
  AES-GCM round trip／wrong-key failure、Origin／Access boundary、
  512 KiB raw request 及 64 KiB decoded statement cap

完整 Phase 2C 的完成條件：

1. 使用者可以貼上真實格式但匿名化的銀行文字，看到可修改的草稿。
2. AI failure 不會建立 transaction，亦不會遺失已在畫面中的原文。
3. 所有 authoritative 金額均由 Worker minor-unit parser 產生。
4. Parser 永遠零 ledger writes；plaintext API key 不會進入 browser storage、D1、
   bundle、Git、logs、screenshots 或 fixtures。選擇 persistence 時 D1 只保存
   ciphertext，settings response 只提供 redacted metadata。
5. Edited rows 必須重新 preview；new 預設選取，possible duplicate 預設不選。
6. Commit 前由 Worker 重新驗證 live references 及 duplicate 狀態，所有選取 row 在
   同一 D1 batch 寫入。
7. 相同來源重新解析會得到相同 source key；transaction 被刪除後 tombstone 仍阻止
   靜默 re-import。
8. Desktop/mobile keyboard review、focus restore、zero console errors 及 zero horizontal
   overflow 通過 browser smoke test。
