# 아트브릿지 (관람 · 공유 전시 · 작가 · 운영)

Python 3.10 이상에서 실행합니다. 별도 패키지 설치는 필요 없습니다. QR은 MIT 라이선스의 Nayuki QR Code generator를 프로젝트에 포함해 서버에서 생성합니다.

## 실행

- 프로젝트 폴더의 `run_server.bat` 더블클릭 → 서버 시작 + 브라우저 자동 열기
- 또는 터미널에서 `py backend/server.py` 실행 후 http://localhost:8000 접속
- 종료: 서버 창에서 `Ctrl + C`

> `index.html`을 더블클릭해서 열면(file://) 로그인·작품 목록이 동작하지 않습니다. 반드시 서버 주소로 접속하세요.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `server.py` | 웹 서버 + API |
| `experience.py` | 공유 전시, 작가 이야기, 해설 검수, 관심 작품, 설치 확인, 기간별 성과 API |
| `qrcodegen.py` | QR 생성기 (MIT, 파일 상단 라이선스 포함) |
| `test_experience.py` | 원본 DB·이미지의 임시 복사본에서 실행하는 회귀 테스트 |
| `artbridge.db` | SQLite DB (회원, 세션, 부서 키, 작품, 공감, 위치 이동 이력) — 처음 실행 시 자동 생성 |
| `media/` | 작품 이미지 파일 (`/media/파일명`으로 제공) — 처음 실행 시 자동 생성 |
| `seed/artworks.json` | 대덕전자 작품 리스트(엑셀 PDF)에서 정리한 초기 작품 157점 |
| `seed/images/` | 대표작 이미지 PDF에서 추출한 실제 작품 사진 24장 (파일명 = 작품 ID) |
| `seed/visual_descriptions.json` | 실제 사진을 확인해 작성한 색·구도·대상 설명. 변경되지 않은 원본 사진에만 적용 |

## 데이터 저장

| 항목 | 저장 위치 |
|---|---|
| 회원 정보 (이름, 부서, 이메일, 등급) | `artbridge.db` |
| 비밀번호 · 부서 관리자 키 | PBKDF2-SHA256 + salt 해시만 저장 (원문 저장 안 함) |
| 로그인 상태 | 서버 `sessions` 테이블 + 브라우저 HttpOnly 쿠키 (`로그인 유지` 시 30일) |
| 작품 정보 · AI 설명 · 조회수 · 위치 | `artbridge.db`의 `artworks` |
| 작품 이미지 | `media/` 폴더 |
| 공감 | `artwork_likes` (회원별 1회) |
| 위치 이동 이력 | `artwork_moves` (작품이 삭제돼도 이력은 남음) |
| 배치 신청 | `placement_requests` (작품이 삭제되면 함께 삭제) |
| 감상 반응 (별점 1~5 · 감정 · 댓글 300자) | `artwork_reactions` (회원 1명당 작품별 1개, 다시 남기면 수정) |
| 기획 전시 · 공개 활동 기록 · 작가 이야기 | 서버 DB. 기획 전시는 고유 공유 주소로 다른 브라우저에서도 열림 |
| 관심 작품 · 해설 수정 제안 · 검수 기록 | 서버 DB, 회원별 보관 및 관리자 검수 |
| 기간별 조회·듣기·QR 기록 | `experience_events` (새 기능 적용 이후부터 수집) |
| 글자 크기 · 고대비 · 움직임 줄이기 | 브라우저 localStorage |

기존 DB는 시작할 때 필요한 테이블과 열을 추가하며 유지됩니다. 과거 승인 건은 이미 위치가 변경된 기록으로 이관하며, 사진으로 확인한 설치 성과에는 포함하지 않습니다. 기존 브라우저에서 직접 만든 전시는 작성자가 로그인하면 서버로 한 번 이관됩니다.

## 관람 기능

- 홈에서 이달의 전시, 오늘의 작품, 작가를 먼저 만나고 관리 절차는 접어서 볼 수 있습니다.
- 작품 사진 필터·검색·정렬·더 보기, 작가별 작품, 공간별 안내 및 10분 감상 코스를 제공합니다.
- 회원이 아니어도 작품 설명과 시각 묘사를 읽고 들을 수 있습니다. 듣기는 기기의 한국어 음성 합성을 사용하며 일시정지·이어듣기·정지·속도를 지원합니다.
- 해설 초안은 등록된 사실과 작가의 작품 설명으로 구성합니다. 외부 생성형 AI는 연결하지 않았습니다. 검수되지 않은 초안과 검수 공개본을 구분하며, 회원의 수정 제안은 관리자 승인 전까지 공용 설명을 바꾸지 않습니다.
- 작가 이야기·인터뷰는 관리자가 실제 내용을 입력합니다. 공개에는 동의 확인이 필요합니다. 제공되지 않은 이야기는 만들지 않습니다.
- 전시 관람은 모바일 이전·다음 버튼, 스와이프를 지원합니다. 3D는 정면 0도에서 열리며 ±45도·180도 버튼은 현재 각도에 누적됩니다.
- 회원은 관심 작품을 보관하고 모든 작품의 사내 전시를 제안할 수 있습니다.
- 작가에게 전할 감상은 관리자 검수 화면에서 최근 댓글 30건 CSV로 내려받아 전달할 수 있습니다.
- 통계는 7일·30일·90일·전체 기간의 조회·듣기·QR·반응 참여·사진 확인 설치, 월별 조회, 사진 등록 현황을 보여 줍니다. 조회 등은 반복 방문을 포함한 횟수이고, 사진·작가·작품 수는 현재 현황입니다.

## 공유 주소와 QR

작품은 `/#art/작품ID`, 작가는 `/#artist/작가명`, 전시는 `/#exhibition/전시ID`로 바로 열 수 있습니다. 작품 QR은 SVG로 다운로드·인쇄할 수 있으며 외부 QR 서비스에 작품 주소를 전송하지 않습니다.

`localhost` 주소는 현재 컴퓨터에서만 열립니다. 다른 휴대폰에서 QR을 읽으려면 서버에 접근 가능한 사내 주소나 배포 주소로 사이트를 연 뒤 QR을 만들어야 합니다. 공개 배포·도메인 설정은 별도입니다.

## 초기 작품 데이터

- 출처: `대덕전자 장애 예술인 작품 리스트`(2026년 8월 기준) 중 **2.작품 리스트_RAWDATA** 시트 → 157점
  - 작가명, 작품명, 제작연도, 인수일자, 테마, 재료, 크기, 작가의 작품 설명, 설치위치, 비고(액자)
  - 작가 화풍·활동 기간은 **1.작가현황** 시트에서 가져와 작가 소개로 사용
- 이미지: `대덕전자_대표작_이미지모음` PDF의 28장 중 **실제 작품 사진 24장**만 연결
  - 'AI 생성'으로 표시된 대체 이미지 4장(春 萬花, 더불어 살아요, 까마귀, 임이정)은 실제 작품이 아니고
    작품 리스트에도 없어 연결하지 않음
  - 나머지 133점은 사진이 없어 화면에서 '이미지 준비 중'으로 표시 → 관리자가 `정보 수정`에서 사진 등록 가능
- 설치위치 → 위치 ID: HQ 식당(`HQ-CAFE`), HQ 3F 복도(`HQ-3F`), HQ 연구소(`HQ-LAB`), HQ VIP 앞(`HQ-VIPF`),
  HQ VIP(`HQ-VIP`), B1 해동기념관 복도(`B1-HALL`), B1 VIP(`B1-VIP`), M1 식당(`M1-CAFE`), 창고 보관(`STORE`),
  설치위치가 비어 있던 68점은 위치 미정(`NONE`)
- 서버를 **처음 켤 때 한 번만** 등록됩니다. 이후 관리자가 작품을 지워도 다시 채워지지 않습니다.
  (처음부터 다시 받으려면 서버를 끄고 `artbridge.db`와 `media/`를 지운 뒤 다시 실행 — 회원 정보도 초기화됨)

## 권한

| 기능 | 비회원 | 일반 회원 | 관리자 |
|---|:-:|:-:|:-:|
| 작품 목록·상세·이미지 보기, 조회수 | ✅ | ✅ | ✅ |
| AI 설명 읽기·음성 듣기·화면에서 생성 (저장된 설명이 없으면 자동 준비) | ✅ | ✅ | ✅ |
| 작품 등록 (위치는 `창고 보관`으로 시작) | ❌ | ✅ | ✅ (위치 지정 가능) |
| 공감, 관심 작품 보관, 해설 수정 제안 | ❌ | ✅ | ✅ |
| 해설 검수·공용 설명 공개, 작가 이야기 편집 | ❌ | ❌ | ✅ |
| 공유 전시 관람 / 전시 만들기 | 관람 | 관람·만들기 | 관람·만들기·대표 전시 지정·삭제 |
| 감상 반응 보기 | ✅ | ✅ | ✅ |
| 감상 반응 남기기·수정 | ❌ | ✅ | ✅ |
| 감상 반응 삭제 | ❌ | 본인 반응만 | 모든 반응 |
| 작품 삭제 | ❌ | **본인이 등록한 작품만** | **모든 작품** (화면에서 ‘삭제’ 입력으로 한 번 더 확인) |
| 작품 정보·이미지 수정, 위치 이동, 이동 이력 | ❌ | ❌ | ✅ |
| 배치 신청 | ❌ | 모든 작품 | 모든 작품 |
| 배치 신청 취소 | ❌ | 본인 신청 (대기 또는 설치 대기) | 대기 또는 설치 대기 신청 |
| 배치 신청 승인·반려 / 실제 설치 확인 | ❌ | ❌ | ✅ (설치 사진 확인 후 작품 위치와 이동 이력 변경) |

## 배치 신청 규칙

- 신청할 수 있는 위치: 실제 전시 공간만 (`창고 보관`, `위치 미정` 제외), 현재 걸려 있는 위치는 불가
- 작품 하나에 **대기 또는 승인 후 설치 대기 신청은 1건만** 허용합니다.
- 시작일은 오늘 이후, 종료일은 시작일 이후
- 상태: `pending`(대기) → `approved`(승인) / `rejected`(반려) / `cancelled`(신청자 취소)
- 처리된 신청에는 처리한 관리자 이름·시각·메모가 남음
- 승인만으로 작품 위치를 바꾸지 않습니다. 관리자가 실제 설치 사진을 등록하고 설치 사실을 확인하면 위치와 이동 이력을 변경하고 사진·확인자·확인 시각을 기록합니다.

## 일반 회원 / 관리자 가입

- **일반 회원**: 이름·이메일·비밀번호만으로 가입 (부서 없음)
- **관리자**: 등록된 부서 중 하나를 고르고, 그 부서의 **관리자 키**를 입력해야 가입 가능
  - 다른 부서의 키로는 가입할 수 없음 (부서마다 키가 다름)
  - 관리자는 `회원 관리` 화면 하단 **부서별 관리자 키**에서 부서 추가 / 키 재발급 가능
  - 새 키(`DD-XXXX-XXXX-XXXX`)는 발급 순간 한 번만 표시되고, 재발급하면 이전 키는 즉시 무효
  - 같은 IP에서 키를 5번 틀리면 5분간 관리자 가입 제한

처음 DB가 만들어질 때 등록되는 시연용 부서 키는 `server.py`의 `DEFAULT_DEPT_KEYS`에 있습니다.
**시연이 끝나면 관리자 화면에서 모든 부서 키를 재발급**해 기본 키를 무효화하세요.

## API

### 회원

| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/health` | 서버 상태 확인 | 누구나 |
| GET | `/api/auth/me` | 현재 로그인 사용자 (`user` 또는 `null`) | 누구나 |
| GET | `/api/departments` | 관리자 가입용 부서 목록 (부서명만) | 누구나 |
| POST | `/api/auth/signup` | 회원가입 후 자동 로그인 `{type: "member"\|"admin", name, dept?, email, password, adminKey?, agree}` | 누구나 |
| POST | `/api/auth/login` | 로그인 `{email, password, remember}` | 누구나 |
| POST | `/api/auth/demo` | 시연용 원클릭 로그인 `{type: "admin" \| "member"}` | 누구나 (설정으로 끄기 가능) |
| POST | `/api/auth/logout` | 로그아웃 (서버 세션 삭제) | 누구나 |
| POST | `/api/auth/change-password` | 내 비밀번호 변경 `{currentPassword, newPassword}` (다른 기기 로그인 해제) | 로그인 회원 |
| GET | `/api/users` | 회원 목록 — 비밀번호 해시는 반환 안 함 | 관리자 |
| DELETE | `/api/users/{id}` | 회원 계정 삭제 (본인 삭제 불가) | 관리자 |
| POST | `/api/users/{id}/reset-password` | 임시 비밀번호 발급 `{tempPassword}` (한 번만 반환) | 관리자 |
| PATCH | `/api/users/{id}/role` | 등급 변경 `{role}` (본인 변경 불가) | 관리자 |
| GET | `/api/admin/dept-keys` | 부서별 키 현황 (키 자체는 반환 안 함) | 관리자 |
| POST | `/api/admin/dept-keys` | 부서 추가 + 새 키 발급 `{dept}` → `{dept, key}` | 관리자 |
| POST | `/api/admin/dept-keys/rotate` | 키 재발급 `{dept}` → `{dept, key}` | 관리자 |

### 작품

| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/meta` | 설치 위치 목록, 테마 목록 | 누구나 |
| GET | `/api/artworks` | 작품 전체 (로그인 시 `likedByMe`, `canDelete`, `canEdit` 포함) | 누구나 |
| POST | `/api/artworks` | 작품 등록 `{title, artist, year?, medium?, size?, theme?, tags?, intent?, artistBio?, locationId?, image?}` — `image`는 `data:image/jpeg;base64,...` (JPG/PNG/WEBP, 5MB 이하) | 로그인 회원 |
| PATCH | `/api/artworks/{id}` | `ai` 검수 공개 / `locationId`+`reason` 이동 / 정보·이미지·`visualDescription` 수정. 정보·사진 변경 시 이전 해설 검수 상태 초기화 | 관리자 |
| DELETE | `/api/artworks/{id}` | 작품 삭제 (이미지 파일·공감도 함께 삭제) | 관리자 또는 등록한 본인 |
| POST | `/api/artworks/{id}/like` | 공감 토글 → `{liked, likes}` | 로그인 회원 |
| POST | `/api/artworks/{id}/view` | 조회수 +1 → `{views}` | 누구나 |
| GET | `/api/moves` | 최근 위치 이동 이력 50건 | 관리자 |
| GET | `/api/requests` | 배치 신청 목록 (관리자: 전체 / 회원: 내 신청) | 로그인 회원 |
| POST | `/api/requests` | 배치 신청 `{artworkId, locationId, from, to, note?}` | 로그인 회원 |
| POST | `/api/requests/{id}/approve` | 승인 `{adminNote?}` → 설치 대기 | 관리자 |
| POST | `/api/requests/{id}/reject` | 반려 `{adminNote?}` | 관리자 |
| POST | `/api/requests/{id}/cancel` | 대기·설치 대기 신청 취소 | 신청한 본인 또는 관리자 |
| GET | `/api/artworks/{id}/reactions` | 작품별 감상 반응 목록 + 평균 별점 + 내 반응 | 누구나 |
| POST | `/api/artworks/{id}/reactions` | 반응 남기기/수정 `{rating: 1~5, feelings?, comment?}` | 로그인 회원 |
| DELETE | `/api/reactions/{id}` | 반응 삭제 | 작성자 본인 또는 관리자 |
| GET | `/api/reactions/summary` | 통계용: 반응 수·평균 별점·감정 분포·최근 댓글 30개 | 누구나 |
| GET | `/media/{파일명}` | 작품 이미지 | 누구나 |

오류 응답 형식: `{"error": "한국어 메시지", "field": "email"}`

### 관람·공유·검수

| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/experience` | 전시·작가·공개 활동, 로그인 회원 본인 관심 작품. 미공개 작가 초안은 관리자에게만 반환 | 누구나 |
| POST | `/api/exhibitions` | 전시 저장 `{title, curator, desc, artworkIds}` | 로그인 회원 |
| DELETE | `/api/exhibitions/{id}` | 전시 삭제 | 관리자 |
| POST | `/api/exhibitions/{id}/feature` | 이달의 전시 지정 | 관리자 |
| PATCH | `/api/artists/{이름}` | `{story, interview, published, consentConfirmed}` | 관리자 |
| POST | `/api/artworks/{id}/bookmark` | 관심 작품 토글 | 로그인 회원 |
| POST | `/api/artworks/{id}/ai-proposals` | 수정 제안 `{ai: {full, easy, caption}}` | 로그인 회원 |
| GET | `/api/ai-proposals` | 관리자 전체 / 회원 본인 제안 | 로그인 회원 |
| POST | `/api/ai-proposals/{id}/approve` 또는 `/reject` | 제안 검수. 승인 시 공용 설명 갱신 | 관리자 |
| POST | `/api/artworks/{id}/events` | 듣기·QR 횟수 `{kind: "listen" 또는 "qr"}` | 누구나 |
| GET | `/api/artworks/{id}/qr?url=...` | 작품 공유 주소를 인코딩한 SVG QR | 누구나 |
| GET | `/api/impact?days=7` | 기간별 성과 (`7`, `30`, `90`, `all`) | 누구나 |
| POST | `/api/requests/{id}/install` | 승인 건 실제 설치 사진 `{image}`과 위치 확인 | 관리자 |

## 검증

프로젝트 폴더에서 `python -m unittest discover -s backend -p test_experience.py -v`, `node --check script.js`, `node --check experience.js`를 실행합니다. 테스트는 원본 DB와 사진을 임시 폴더에 복사해 공유·회원별 보관·해설 검수·작가 공개 동의·설치 확인·기간별 성과를 검증하고 복사본을 제거합니다.

## 보안 장치

- 같은 이메일로 로그인 5회 실패 시 5분간 로그인 제한
- 세션 토큰은 DB에 해시로만 저장, 쿠키는 `HttpOnly; SameSite=Lax`
- 서버는 `backend/` 폴더와 숨김 파일을 웹으로 내보내지 않음 (DB 파일 노출 방지)
- 업로드 이미지는 형식(JPG/PNG/WEBP)·크기(5MB)·파일 서명까지 확인 후 무작위 파일명으로 저장
- 작품 삭제·수정·위치 이동 권한은 화면뿐 아니라 서버에서도 다시 검사

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ARTBRIDGE_PORT` | 8000 | 서버 포트 |
| `ARTBRIDGE_DEMO_LOGIN` | 1 | 시연용 원클릭 로그인 허용 (실서비스는 0) |
| `ARTBRIDGE_DB` | `backend/artbridge.db` | DB 파일 경로 (테스트용) |
| `ARTBRIDGE_MEDIA` | `backend/media` | 이미지 폴더 경로 (테스트용) |

시연용 계정의 이메일·비밀번호는 `server.py`의 `DEMO_USERS`에 있습니다.
