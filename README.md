# 빌딩 매니저 (Building Manager) v2

시설관리(FM) 회사용 **모바일 웹앱 2종** + **비공개 Google 스프레드시트 백엔드**.
서버·DB 비용 0원(정적 호스팅 + Google Apps Script), PWA로 "홈 화면에 추가"하면 앱처럼 사용.

| 파일 | 용도 |
|---|---|
| `index.html` | **관리자 앱** — 대표 / 운영자(사업부) / 관리소장 / 실무자(팀장) / 갑사 담당자 / 전산관리자(CMS) |
| `resident.html` | **안내앱** — 구분소유주·입주민·입주사용 (공지 알림 · 투표 전용 · 관리비 · 민원) |
| `apps-script/Code.gs` | Google Apps Script 웹앱 (비공개 시트 DB, Drive PDF 업로드, 안내앱 엔드포인트) |
| `manifest.webmanifest` / `manifest-resident.webmanifest` / `sw.js` / `icon-*.png` | PWA(앱 모드) 구성 |
| `_headers` | Cloudflare Pages 응답 헤더(서비스워커·매니페스트 캐시/MIME) |

---

## 1. Cloudflare Pages 배포 (권장 — HTTPS·앱 모드 자동 충족)

GitHub 저장소(`olabi/building-manager`)를 연결하면 push 때마다 자동 배포됩니다. 빌드 과정이 없는 정적 사이트입니다.

### 1-1. 대시보드에서 연결
1. <https://dash.cloudflare.com> 로그인 → 왼쪽 **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git**.
2. GitHub 인증 → 저장소 **olabi/building-manager** 선택 (비공개 저장소도 가능; "Only select repositories"로 이 저장소만 허용 권장).
3. 빌드 설정:

| 항목 | 값 |
|---|---|
| Project name | `building-manager` (→ `https://building-manager.pages.dev`) |
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(비워 둠)* |
| Build output directory | `/` — `index.html`이 저장소 **루트**에 있을 때<br>`building-manager` — `building-manager/index.html`처럼 **하위 폴더**에 넣었을 때 |
| Root directory | *(비워 둠)* |

4. **Save and Deploy** → 1분 내 `https://building-manager.pages.dev` 생성.
5. 접속 URL
   - 관리자 앱: `https://building-manager.pages.dev/` (= `index.html`)
   - 안내앱: `https://building-manager.pages.dev/resident.html?site=<사업장ID>&gas=<AppsScriptURL>` (전산관리자 › 시스템 › "안내앱 링크 복사"로 생성)

### 1-2. CLI로 배포(Git 연결 없이 즉시 올릴 때)
```bash
npm i -g wrangler
wrangler login
cd building-manager            # index.html 이 있는 폴더
wrangler pages deploy . --project-name building-manager
```

### 1-3. 배포 후 확인
- 주소창 자물쇠(HTTPS) → Android Chrome은 "앱 설치" 배너, iOS Safari는 **공유 → 홈 화면에 추가**.
- `https://…/sw.js`, `https://…/manifest.webmanifest`가 200으로 열리는지 확인.
- 전산관리자 › 시스템에 Apps Script URL·비밀키 입력 → "연결 테스트".
- 커스텀 도메인: Pages 프로젝트 › **Custom domains** › 회사 도메인 추가(DNS가 Cloudflare면 자동 설정).
- 사내 전용으로 제한하려면 **Cloudflare Access**(Zero Trust › Access › Applications)로 `*.pages.dev` 또는 커스텀 도메인에 이메일 OTP/Google 로그인 정책을 걸면 무료 50석까지 가능.

### 1-4. 자주 나는 오류
| 증상 | 원인/조치 |
|---|---|
| 404 Not Found | Build output directory가 틀림. 저장소에서 `index.html` 위치 확인 후 `/` 또는 폴더명으로 수정 → Retry deployment |
| 앱 설치 버튼이 안 뜸 | http 접속이거나 매니페스트 404. `_headers`가 배포 디렉터리에 함께 있는지 확인 |
| 수정했는데 화면이 옛날 버전 | 서비스워커 캐시. `sw.js`의 `CACHE` 이름(`bm-shell-v2`)을 올리고 다시 push |
| Apps Script 호출 CORS 오류 | Apps Script 배포 설정이 "액세스: 모든 사용자(Anyone)"인지, URL이 `/exec`로 끝나는지 확인 |

---

## 2. Google 스프레드시트(비공개) 백엔드 연동

1. 새 스프레드시트 생성(공유: **제한됨** 유지).
2. 확장 프로그램 › **Apps Script** → `apps-script/Code.gs` 내용 붙여넣기.
3. 상단 `SECRET`(비밀키)을 임의 문자열로 변경, `DRIVE_FOLDER_NAME`(PDF 첨부 저장 폴더) 필요 시 변경.
4. **배포 › 새 배포 › 웹 앱**: 실행 주체 **나(소유자)**, 액세스 **모든 사용자** → `/exec` URL 복사.
   - 시트와 Drive는 비공개로 유지되고, 스크립트만 소유자 권한으로 대신 읽고 씁니다. 요청은 비밀키로 검증합니다.
5. 관리자 앱 › 전산관리자 › **시스템**에 URL과 비밀키 입력 → 연결 테스트 → 이후 저장 시 자동 동기화(안내앱은 60초 주기 폴링).
6. 시트에는 `reports / sites / users / forms / notices / polls / fees / complaints …` 탭이 자동 생성되어 대표가 피벗·차트를 직접 만들 수 있습니다. 긴 데이터는 셀 50,000자 제한을 피해 분할 저장됩니다.

> 시트 없이도 동작: 미연동 상태에서는 브라우저 저장소(localStorage)에 저장되며, 같은 브라우저에서 `index.html` → `resident.html` 순으로 열면 데이터가 공유됩니다(데모용).

---

## 3. 기능 요약

### 관리자 앱 (`index.html`)
- **전산관리자 CMS**: 회사명·사업장·계약사/PM·사용자·역할명·양식을 화면에서 수정. 기존 서식 문구에 `{{항목명}}`을 넣으면 빈칸 양식 완성(텍스트/숫자/서술/선택/체크/날짜/**파일(PDF)**). 통계항목·결재선 지정.
- **실무자(팀장)**: 양식 선택 → 빈칸 입력 → 문장 자동 완성 → 결재란 포함 A4 **PDF**(브라우저 인쇄) → 제출. 기본 양식: 점검결과서·작업일보·구매요청서·민원처리보고서·**일일보고**·**이슈사항 보고**·**서식 PDF 제출**.
- **결재**: 승인/반려(사유)·재제출·이력 타임라인. 코멘트는 사업장 지시사항으로 전달.
- **운영자(사업부)**: 전 사업장 카드(금일 일일보고 제출 여부·결재중·반려·계약만료 D-day), 실시간 지시.
- **대표 대시보드(MIS)**: 기간별 KPI, 사업장/양식별 현황, 통계항목 자동 합계, 향후 7일 중요 일정, 미해결 이슈(심각도순), 대표 결재 대기.
- **갑사 담당자**: 자기 사업장 보고서·일정 열람, 요청사항 전송(`[갑사 요청]`으로 관리소에 표시).
- **일정 탭**: 사업장별 업무일정, ⭐중요 표시 → 대표 대시보드 노출.
- **안내앱 관리**(관리소장): 공지 작성, 승인 보고서 "📢 안내앱에 게시 + 알림 공고", 투표 안건 등록/마감, 관리비 고지, 민원 처리, **입주민 사용 승인/해제**.
- 🔔 통합 알림: 내 결재 대기·미완료 지시·승인 대기 사용자/입주민·미처리 민원.

### 안내앱 (`resident.html`)
- 공지 / 투표 / 관리비 / 민원 하단 탭(아파트아이형 구조). 오피스·주거 공용(세대 = 호실/입주사).
- 새 공지·투표·관리비 고지 시 NEW 배지 + 브라우저 알림(권한 허용 시).
- **투표는 입주민이 "투표만"** 가능(세대당 1표, 이후 결과 열람). 안건 등록·마감·삭제는 관리자 앱에서만.
- 게시판은 관리소 안내·홍보 자료만.

### 사용권한
- 두 앱 모두 **사용 신청 → 관리자 승인** 후 로그인 가능 (`status !== approved` 차단).
  - 관리자 앱: 전산관리자 › 사용자·권한 탭에서 승인/거절/해제.
  - 안내앱: 건물 접속코드 + 세대 + PIN으로 신청 → 관리소장이 승인/해제.
- 사업장 **계약종료일 경과 시 두 앱 모두 자동 차단**(데모: 리버뷰빌딩 조소장).

### 데모 계정
- 관리자 앱: 첫 화면 역할 버튼으로 체험. 승인 대기 데모 `한신입`.
- 안내앱: 한빛아파트 · `304동 1203호` · PIN `1234`. 승인 대기 데모 `305동 101호 박신청`.

---

## 4. 지정 PC(사내망) 호스팅 — DB 구축비 0원 대안
Cloudflare 대신 사업장 지정 PC에서만 쓸 때:
```bash
cd building-manager
python -m http.server 8080      # http://<PC IP>:8080
```
http 접속은 PWA 설치·브라우저 알림이 제한되므로, 외부 공개 없이 앱 모드가 필요하면 Cloudflare Pages + Cloudflare Access(사내 계정만 허용) 조합을 권장합니다.

---

## 5. 운영 전환 체크리스트
- [ ] 데모 "사용자 선택" 로그인 → ID/PIN 또는 Google 로그인(Cloudflare Access 사용 시 Access 이메일로 대체 가능)
- [ ] Apps Script `SECRET` 변경, Drive 첨부 폴더 공개 범위(기본 "링크 아는 사람 열람") 조정
- [ ] 사업장별 계약종료일 입력(권한 자동 해제 기준)
- [ ] 앱 종료 상태 알림이 필요하면 Web Push 서버 또는 Apps Script 트리거로 이메일/카카오 알림톡 발송 추가
- [ ] 동시 사용자가 많아지면 시트 저장을 스냅샷 → 보고서 단위 append로 전환
- [ ] 사진 첨부(현재 PDF만, 2MB 제한) 필요 시 Drive 업로드 경로 재사용

## 6. 벤치마킹
UpKeep · MaintainX · Limble(모바일 CMMS 체크리스트/대시보드), 아파트아이 · 아파트너 · 하이엠(입주민 공지·관리비·민원·전자투표), 다우오피스 · 하이웍스(한국식 결재선), Google AppSheet(시트 기반 노코드).
차별점: ① 빈칸→문장 자동완성으로 행정역량 보완, ② 결재란 포함 한국식 PDF, ③ 사용자당 과금 없는 0원 구조, ④ 내부 보고앱과 입주민 안내앱 분리 + 승인제 권한.
