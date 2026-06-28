# dorms-HTML-making-class

학생이 **직접 만든 결과물**(수학 풀이, 글 정리, 실험 기록 등)을 AI 튜터와 대화하며 **반응형 HTML 웹페이지**로 완성하는 수업용 웹앱입니다. 같은 와이파이에 접속한 학생들이 브라우저로 들어와 바로 사용합니다.

기본 템플릿은 **"수학 풀이 웹 디자이너"**지만, 수업 지침인 `system-prompt.txt` 한 파일만 바꾸면 국어·영어·과학·사회 등 **어떤 교과에도 맞게 튜닝**할 수 있습니다.

> 핵심 원칙: AI가 학생 대신 문제를 풀어주지 않습니다. 학생이 스스로 푼 과정을 받아, 그것을 보기 좋은 웹페이지로 만들어주는 역할만 합니다.

## 🤖 가장 쉬운 설치: AI에게 맡기기

깃허브·터미널을 몰라도 됩니다. 아래 프롬프트를 복사해 당신의 AI(ChatGPT · Claude · Gemini 등)에게 붙여넣으면, AI가 이 저장소를 받아 **당신 수업에 맞게 설치·설정**까지 해줍니다. 당신은 "무슨 과목에 쓸지", "API 키" 같은 질문에만 답하면 됩니다.

👉 **복붙용 프롬프트 전체: [AI_SETUP.md](AI_SETUP.md)**

<details>
<summary>📋 프롬프트 미리 펼쳐보기</summary>

```text
너는 지금부터 "수업용 HTML 만들기 웹앱"을 내 컴퓨터에 설치해 주는 설치 도우미야.
나는 이 앱을 내 수업에 쓰려는 교사이고, 깃허브·터미널·코딩을 잘 몰라.
네가 처음부터 끝까지 이끌어 주고, 직접 할 수 있는 일은 직접 해줘.

[설치할 앱]
- 저장소: https://github.com/shinnanchanguk/dorms-HTML-making-class
- 무엇: 학생이 자기가 직접 만든 결과물(수학 풀이·영어 글·과학 보고서 등)을 너 같은 AI와
  대화하며 예쁜 반응형 HTML 웹페이지로 완성하고 제출하는 도구. 같은 와이파이에 접속한
  학생들이 브라우저로 들어와서 사용해.
- 핵심 원칙: AI가 학생 대신 답을 만들어 주지 않고, 학생이 직접 한 것을 보기 좋게 만들어 주기만 함.

[먼저 네 능력을 확인]
- 명령 실행·파일 수정이 가능한 도구라면(예: 코딩 에이전트): git clone, 설치, 파일 수정,
  서버 실행까지 네가 직접 해줘. 나한테는 사람이 답할 수 있는 질문만 해.
- 웹 채팅이라 실행을 못 하면: 내가 터미널에 그대로 붙여넣을 명령을 한 줄씩 정확히 알려주고,
  고쳐야 할 파일은 완성된 내용을 통째로 만들어 줘. Node.js가 깔려 있는지부터 확인해.

[나에게 물어볼 것 — 한 번에 하나씩, 쉬운 말로]
1) 어떤 과목·활동에 쓸 거야? (기본 템플릿은 수학 풀이. 다른 과목이면 그에 맞게 바꿔줘.)
2) 학생 구성: 몇 개 반이고, 반당 몇 명?
3) 관리자(나) 로그인 비밀번호로 뭘 쓸까?
4) OpenRouter API 키. (https://openrouter.ai/keys 에서 발급 — 발급 절차도 안내해줘.)

[받은 답으로 설정]
- .env 파일을 만들어(.env.example 복사) 채워줘: OPENROUTER_API_KEY, SESSION_SECRET(무작위 생성),
  ADMIN_ID, ADMIN_PASSWORD, SEED_CLASSES, SEED_STUDENTS_PER_CLASS, 필요하면 AI_MODEL.
- system-prompt.txt: 내 과목에 맞게 AI의 역할과 대화 흐름을 다시 써줘. 단, "학생이 직접 한
  결과물만 다룬다 / AI가 대신 풀거나 써주지 않는다 / 한국어 응답 / 단일 HTML 생성" 뼈대는 유지.
- public/index.html, public/chat.html 의 제목·안내 문구를 내 과목에 맞게 바꿔줘.

[실행하고 알려줄 것]
- WSL2 + Windows면 `bash start.sh` 한 번으로 같은 와이파이 접속까지 설정(출력의 '학생 접속 주소'를
  학생에게 공유). 그 외 환경이면 `npm install` 후 `npm start`, http://<로컬 IP>:<포트> 로 접속.
- 다 되면 요약해줘: ① 학생 접속 주소 ② 관리자 로그인법 ③ 학생 로그인법(학번 1{반}{번호 2자리},
  예 1101=1반1번; 첫 로그인 때 비번 설정) ④ 서버 끄는 법.

[규칙] 전문용어는 풀어서 설명 / 민감정보는 길게 재출력 금지 / 예고만 말고 바로 실행.
```

</details>

> 직접 설치하고 싶다면 아래 [빠른 시작](#빠른-시작)을 따르세요.

## 이렇게 동작합니다

1. 학생이 학번으로 로그인 (첫 접속 때 직접 비밀번호 설정)
2. 자기가 푼 문제와 풀이를 사진이나 텍스트로 올림
3. AI와 대화하며 풀이를 정리하고, 원하는 디자인 아이디어를 말함
4. AI가 KaTeX 수식까지 렌더링되는 단일 HTML 파일을 생성
5. 미리보기로 확인하고 수정 → 마음에 들면 '제출하기'
6. 선생님은 관리자 대시보드에서 제출물과 대화로그를 확인

## 주요 기능

- 🔐 학번 기반 로그인 (학생이 직접 비밀번호 설정, 관리자가 초기화 가능)
- 💬 실시간 스트리밍 채팅 (SSE, 응답 끊김 시 자동 이어받기)
- 🖼️ 이미지 업로드 — 손으로 푼 풀이 사진을 그대로 분석
- 🧮 KaTeX 수식 렌더링
- 📄 단일 HTML 파일 생성 → 미리보기 / 다운로드 / 제출
- 🛠️ 유지보수 모드 — 이전에 만든 HTML을 붙여넣어 수정
- ⏱️ 반·학생별 세션 횟수 / 이용 시간대 제한
- 📊 관리자 대시보드 — 학생·제출물·대화로그 관리

## 빠른 시작

### 요구사항
- Node.js 18 이상
- [OpenRouter](https://openrouter.ai) API 키

### 설치
```bash
git clone https://github.com/shinnanchanguk/dorms-HTML-making-class.git
cd dorms-HTML-making-class
npm install
```

### 환경설정
```bash
cp .env.example .env
```
`.env`를 열어 `OPENROUTER_API_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD`를 채우세요.

### 실행
```bash
npm start
```
첫 실행 때 `app.db`(SQLite)가 자동 생성되고, `.env` 설정대로 학생·관리자 계정이 만들어집니다. 브라우저에서 `http://localhost:3001`(또는 설정한 `PORT`)로 접속하세요.

## 같은 와이파이의 학생 접속 (WSL2 + Windows)

`start.sh`는 **WSL2 + Windows** 환경에서 같은 와이파이의 학생들이 접속할 수 있게 네트워크를 자동으로 잡아줍니다.

```bash
bash start.sh
```
- 서버 시작과 Windows 방화벽/포트포워딩을 **한 번의 관리자(UAC) 승인**으로 설정합니다.
- 출력 맨 아래 `학생 접속 주소`(예: `http://192.168.0.10:3000`)를 학생에게 공유하세요.
- WSL2 미러링 모드(LAN IP를 직접 가진 경우)와 NAT 모드를 자동으로 판별합니다.

### 네트워크 구조 (왜 포트가 두 개인가)
WSL2 미러링 모드에서는 WSL이 LAN IP를 직접 갖지만, LAN IP로 들어온 인바운드가 WSL 리스너까지 전달되지 않습니다. 그래서:

```
학생 기기 → http://<LAN_IP>:3000 → Windows 포트포워딩 → 127.0.0.1:3001 → WSL 서버
```

서버는 3001에서 listen하고, Windows가 3000으로 들어온 트래픽을 3001로 중계합니다. 학생은 항상 `:3000`으로 접속합니다.

> 일반 리눅스·맥 서버라면 `start.sh` 없이 `npm start`로 띄우고, 같은 네트워크에서 `http://<서버IP>:<PORT>`로 접속하면 됩니다.

## 다른 교과로 바꾸기

이 앱의 "성격"은 거의 전부 `system-prompt.txt`에 담겨 있습니다.

- **교과 바꾸기**: `system-prompt.txt`를 원하는 과목·활동에 맞게 다시 쓰세요. (AI의 역할, 대화 단계, 금지 규칙 등을 자유롭게 정의)
- **화면 문구**: `public/index.html`, `public/chat.html`의 제목과 안내 문구를 교과에 맞게 수정하세요.
- **모델 바꾸기**: `.env`의 `AI_MODEL`을 원하는 OpenRouter 모델로 바꾸세요.

기본 제공되는 수학 템플릿에는 "AI가 답을 알려주지 않고 학생 풀이를 시각화만 한다"는 교육 원칙, 수식 렌더링 규칙, 회귀 방지 수정 원칙 등이 정교하게 들어 있어 다른 교과 지침을 작성할 때 참고하기 좋습니다.

## 환경변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API 키 (필수) | — |
| `AI_MODEL` | 사용할 모델 ID | `google/gemini-2.5-flash` |
| `PORT` | 서버 포트 | `3000` |
| `SESSION_SECRET` | 세션 쿠키 서명키 | `fallback-secret` |
| `ADMIN_ID` | 관리자 아이디 | `admin` |
| `ADMIN_PASSWORD` | 관리자 비밀번호 | `change-this-password` |
| `SEED_CLASSES` | 자동 생성할 반 수 | `5` |
| `SEED_STUDENTS_PER_CLASS` | 반당 학생 수 | `20` |
| `LOCAL_ARCHIVE_DIR` | 제출물 외부 백업 폴더 (선택) | (비활성) |

## 기술 스택

- 백엔드: Node.js + Express
- DB: SQLite (better-sqlite3) — `app.db` 자동 생성
- 세션: express-session + 자체 SQLite 스토어 (재시작해도 로그인 유지)
- 프런트엔드: Vanilla HTML/CSS/JS + KaTeX
- AI: OpenRouter (기본 Gemini 2.5 Flash)

## 보안 주의

- `.env`에 실제 키를 넣고 **절대 커밋하지 마세요** (`.gitignore`에 이미 포함되어 있습니다).
- 배포 전 `ADMIN_PASSWORD`와 `SESSION_SECRET`을 반드시 바꾸세요.
- 학생 데이터(`app.db`, `uploads/`)는 저장소에 포함되지 않습니다.
- 교실 안 같은 와이파이 사용을 가정한 도구입니다. 공개 인터넷에 그대로 노출하지 마세요.

## 라이선스

[MIT](LICENSE) — 자유롭게 가져다 쓰고, 수정하고, 배포하세요.
